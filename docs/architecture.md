# AgriPrice architecture

AgriPrice is a market-intelligence platform for agriculture. It collects crop prices, forecasts them,
and serves them to farmers, traders, buyers, agencies and partners through mobile, web, SMS/USSD
and a public data API. It launches in Ghana (AgriPrice GH). Every other country is added as a
**country pack** (data, not code).

This document describes the system **as built** on `feat/backend-foundation`. Where a requirement is
not yet implemented it is marked **(planned)** and listed in [cross-cutting-status.md](cross-cutting-status.md).

## 1. System context (C4 level 1)

```mermaid
flowchart LR
  farmer([Farmer / trader / buyer<br/>mobile & web])
  feature([Feature phone user<br/>SMS & USSD])
  staff([Admin, org admin,<br/>enumerator, agronomist])
  partner([Researcher / partner<br/>API key])

  subgraph AP[AgriPrice platform]
    core[AgriPrice backend]
  end

  farmer -->|HTTPS / WebSocket| core
  feature -->|SMS / USSD| at[Africa's Talking / Twilio]
  at -->|webhooks| core
  staff -->|admin CMS| core
  partner -->|public data API| core

  core -->|collect, refund, payout| psp[Paystack · Flutterwave · Hubtel<br/>licensed PSPs, hold customer funds]
  core -->|subscriptions| billing[RevenueCat · Stripe]
  core -->|push / email / SMS / WhatsApp| notify[FCM · SES/Postmark · AT/Twilio · WhatsApp Cloud API]
  core -->|ID tokens| idp[Google · Apple · Facebook]
  core -->|forecast + archive| meteo[Open-Meteo]
  core -->|prices| wfp[WFP VAM via HDX]
  core -->|daily FX| fx[ExchangeRate-API open access]
  core -.->|optional| kyc[KYC provider<br/>not yet chosen]
  core -.->|optional| helpdesk[Helpdesk<br/>not yet chosen]
```

## 2. Containers (C4 level 2)

```mermaid
flowchart TB
  subgraph clients[Clients]
    flutter[Flutter app]
    web[Next.js web app<br/>apps/web]
  end

  subgraph region[Per-region deployment · Kubernetes]
    api[API · NestJS 11<br/>apps/api<br/>REST /v1 + Socket.IO /v1/realtime]
    sched[Scheduler · same image<br/>RUN_SCHEDULERS=true<br/>timeouts, refunds, payouts,<br/>reconciliation, retention, badges]
    workers[Workers · BullMQ<br/>apps/workers<br/>notifications, deliveries, alerts,<br/>aggregate refresh, reports, purge, supply snapshot]
    ml[ML service · FastAPI<br/>apps/ml<br/>/predict /explain /train]
    prefect[Prefect 3 flows<br/>pipelines/<br/>nightly per country]
    gotenberg[Gotenberg<br/>HTML → PDF]
    clamav[ClamAV<br/>upload scanning]
  end

  subgraph data[Data stores]
    pg[(PostgreSQL 16<br/>TimescaleDB + PostGIS)]
    redis[(Redis 7<br/>cache, rate limits, OTP,<br/>BullMQ, Socket.IO adapter)]
    s3[(S3 / MinIO<br/>reports, images, evidence)]
    mlflow[(MLflow<br/>runs, model cards)]
    meili[(Meilisearch<br/>optional)]
  end

  flutter & web -->|HTTPS JSON / WSS| api
  api --> pg & redis & s3
  api -.-> meili
  api -->|enqueue| redis
  sched --> pg & redis
  workers --> pg & redis & s3
  workers --> gotenberg
  api --> clamav
  prefect -->|CSV import via API| api
  prefect --> pg
  prefect -->|train, predict| ml
  ml --> pg & mlflow
  ml -->|POST /internal/forecasts/refreshed| api
```

| Container | Tech | Responsibility |
|---|---|---|
| `apps/api` | NestJS 11, TS strict, Drizzle + raw SQL | All REST endpoints (208 operations in `openapi/openapi.yaml`), Socket.IO gateway, webhooks, validation, auth |
| scheduler | same image as API | Order timeouts, PSP refunds/payouts, KYC handoff, daily reconciliation, message retention, weekly badges |
| `apps/workers` | Node 22, BullMQ | Notification fan-out + provider delivery, alert evaluation, CAGG refresh, report rendering, account purge, supply snapshots |
| `apps/ml` | Python 3.12, LightGBM, XGBoost, SHAP | Training, rolling-origin backtests, batch prediction, admin `/predict` `/explain` |
| `pipelines` | Prefect 3 | Nightly per-country flow, FX, WFP prices, weather |
| `packages/contracts` | OpenAPI 3.1 + generated TS types | Single source of truth for clients; CI fails on drift |

## 3. Key flows

### 3.1 Price ingestion (one path for every source)

```mermaid
sequenceDiagram
  participant S as Source (crowd / enumerator / CSV / WFP pull)
  participant A as API PriceIngestService
  participant DB as Postgres (price_observations hypertable)
  participant Q as BullMQ
  participant W as Workers
  S->>A: observation (amount, currency, unit, market, time)
  A->>A: hard validation (amount, dates, ids)
  A->>A: normalise: unit→kg (commodity/country factors), FX→USD, foreign→local
  A->>DB: reference window (90 d, region else country)
  A->>A: robust z-score (rolling MAD, log space) + corroboration
  A->>DB: insert (approved | pending | flagged), idempotent on source_ref / Idempotency-Key
  A-->>Q: evaluate-series (if approved)
  Note over DB: price_daily → price_weekly continuous aggregates refresh every 15 min / 1 h
  W->>DB: alert evaluation against the daily aggregate
```

### 3.2 Nightly forecasting

`pipelines/flows/nightly.py`, per active country: FX → WFP (Mondays) → weather (2nd of month) → data-quality
clean-up → CAGG refresh → features on a weekly panel → rolling-origin CV vs seasonal naive → promote if it beats
the baseline → batch predict with guardrails → SHAP → write `forecast_runs/points/explanations` →
`POST /internal/forecasts/refreshed`, which clears caches and triggers an alert sweep.

### 3.3 Marketplace payment (see [state-machines.md](state-machines.md))

Checkout splits the cart into one order per seller and reserves stock. The buyer pays the PSP, and the PSP webhook
is verified and re-checked with the PSP. The order moves to `paid_in_escrow` and the ledger posts
`psp_clearing → escrow`. Delivery and confirmation (or the auto-release timeout) post `escrow → seller + platform_fees`.
Payouts debit the seller balance and are executed by the PSP.

## 4. Cross-cutting design

| Concern | As built | Notes |
|---|---|---|
| API style | `/v1`, cursor pagination, RFC 9457 problem+json, ISO 8601 UTC, `Accept-Language`, `X-Currency`, `X-Unit` | ETag and the `X-Units` header name are planned |
| AuthN | argon2id, OTP (Redis, hashed), OAuth ID-token verification, 15 min JWT + rotating refresh with reuse detection, TOTP | Socket.IO uses the same JWT |
| AuthZ | Global JWT guard, role guard, entitlement guard, per-country scoping in services | Postgres RLS is planned |
| Money | Decimal strings end to end, DB-enforced balanced ledger | PSPs hold funds |
| Async | BullMQ with deterministic job ids (idempotent), exponential backoff | |
| Config | Country packs in DB (`countries.config`, catalogue tables) seeded from `/country-packs` | |
| Residency | Single-region Terraform today | Per-jurisdiction deploys are planned (§5) |

## 5. Deployment and data residency (target)

```mermaid
flowchart LR
  subgraph eu[eu region]
    eu_api[API/workers/ML] --> eu_pg[(Postgres: PII + prices)]
  end
  subgraph afw[africa-west region · launch]
    af_api[API/workers/ML] --> af_pg[(Postgres: PII + prices)]
  end
  subgraph am[americas region]
    am_api[API/workers/ML] --> am_pg[(Postgres: PII + prices)]
  end
  af_pg -->|anonymised price aggregates only| global[(Global price replica<br/>read-only)]
  eu_pg --> global
  am_pg --> global
```

Each jurisdiction runs its own stack (`infra/terraform` with `env` + `region`). Users, auth, messaging, orders and
payments never leave their region. Only anonymised price data (`price_daily` / `price_weekly` aggregates, no
`submitted_by`, location or notes) replicates to a global read replica for cross-country comparison. **(planned)**
