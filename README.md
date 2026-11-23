# AgriPrice

**Data. Forecasts. Better Decisions.** A global agricultural market-intelligence platform,
launching in Ghana as **AgriPrice GH** and expanding country by country through *country packs*.

## Monorepo

| Path | What it is |
|---|---|
| `packages/contracts` | **OpenAPI 3.1 contract** (`openapi/openapi.yaml`, the single source of truth) + generated TS types |
| `apps/api` | NestJS 11 API (TypeScript strict), Drizzle + raw SQL, reversible SQL migrations, seeder |
| `apps/workers` | BullMQ consumers: notification dispatch (FCM, Africa's Talking, Twilio, SES/Postmark/SMTP, WhatsApp), alert evaluation, aggregate refresh, account purge |
| `apps/ml` | Python 3.12 forecasting: LightGBM quantile + XGBoost median ensemble, walk-forward backtests, SHAP, MLflow |
| `pipelines` | Prefect 3 flows: FX (daily), WFP/HDX prices (weekly), Open-Meteo ERA5 weather (monthly), retrain + forecast (monthly) |
| `country-packs` | Country data (`_global/` + `gh/`). Nothing country-specific lives in code |
| `apps/web` | Next.js web app (frontend, not part of this backend work) |
| `infra` | Terraform (AWS VPC/EKS/ElastiCache/S3 + Timescale Cloud) and a Helm chart |

## Quick start (local)

```bash
cp .env.example .env
docker compose up -d                      # Timescale+PostGIS, Redis, MinIO, Mailpit, MLflow (+ --profile search for Meilisearch)
pnpm install
pnpm db:migrate                           # reversible: pnpm db:rollback [--steps N]
pnpm db:seed gh                           # loads country-packs/_global + gh
pnpm --filter @agriprice/api dev          # http://localhost:3001/docs (contract) · /docs/generated (from decorators)
pnpm --filter @agriprice/workers dev

# data + forecasts (Python 3.12)
pip install -e "apps/ml[dev]" -e "pipelines[dev]"
python -m flows.fx                        # (from pipelines/) real FX rates
python -m flows.wfp_prices                # real WFP prices via the API import endpoint (needs PIPELINE_SERVICE_* creds)
python -m flows.weather
python -m agriprice_ml.train --country GH
```

## Contract-first workflow
1. Edit `packages/contracts/openapi/openapi.yaml` and run `pnpm contract:lint`.
2. Run `pnpm contract:gen` to regenerate the TS types for clients.
3. Implement the handler with `@ApiOperation({ operationId })` matching the spec.
4. Run `pnpm contract:check`. It builds the spec from decorators and fails on any missing, undocumented
   or mismatched operation (path, method, operationId, path params). CI runs all three steps.

## Key design decisions
- **Prices** are stored as observed (amount, currency, unit) **and** normalised (`price_per_kg_local`,
  `price_per_kg_usd`, `fx_rate_id`) in the `price_observations` hypertable. Continuous aggregates `price_daily`
  → `price_weekly` (hierarchical) feed every read endpoint. Responses carry the observed value plus a
  value in the caller's display currency and unit (query → header → user preference → country default).
- **One ingestion path** for crowd, enumerator, CSV and pulled data: validate → normalise → rolling-MAD robust
  z-score (log space) → route (approve / review queue / flag). Idempotent on `source_ref` and `Idempotency-Key`.
- **Forecasts** are precomputed per series (market and region) for 1, 3 and 6 months as p10/p50/p90. Every
  value shown to users is computed and stored: per-series walk-forward MAPE and P10–P90 coverage, a
  confidence label from interval width + MAPE, and the top 7 SHAP drivers with an i18n key and a rendered sentence.
- **Alerts** are edge-triggered with per-alert cooldown and per-user quiet hours. Each (alert, day-bucket,
  scope) can fire once (`dedupe_key`), and the alert row is locked during evaluation. Evaluation is triggered
  by price approval and by a 5-minute watermark sweep over new aggregates.
- **Auth**: argon2id, 6-digit OTP (10-minute TTL, 5 attempts, 30-second cooldown, hourly cap, hashed in Redis),
  Google/Apple ID-token and Facebook token verification, 15-minute JWT access tokens, 30-day rotating refresh
  tokens with family-wide reuse detection, TOTP 2FA + recovery codes (secrets AES-256-GCM at rest), device
  registry, logout everywhere (refresh revocation + access-token cut-off), account deletion with a 30-day
  grace period then hard delete and price anonymisation.
- **Audit**: security and moderation events go to the `audit_log` hypertable. Consents are an append-only ledger.
