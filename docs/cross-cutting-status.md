# Cross-cutting requirements: status

✅ done · 🟡 partial · ❌ not started. "Effort" is a rough size for the remaining work.

## REST conventions
| Requirement | Status | Notes |
|---|---|---|
| `/v1` prefix, cursor pagination, RFC 9457 errors, ISO 8601 UTC | ✅ | |
| ETag + Cache-Control on read endpoints | ❌ | Only one `Cache-Control` header today. Plan: global interceptor computing a weak ETag over the body, `If-None-Match` → 304, per-route max-age (S) |
| Idempotency-Key on resource-creating POSTs | 🟡 | Done on price submissions, checkout, pay, payouts and reports. Plan: a generic Redis-backed interceptor for every creating POST (S) |
| `Accept-Language`, `X-Currency`, **`X-Units`** | 🟡 | Implemented as `X-Unit`. Rename to `X-Units` and keep `X-Unit` as an alias (XS) |

## Security
| Requirement | Status | Notes |
|---|---|---|
| Helmet, CORS allow-list, validation (class-validator) | ✅ | |
| Rate limits per IP, stricter on auth/OTP | ✅ | Redis-backed throttler. OTP also has cooldown, hourly cap and attempt limits |
| Rate limits **per user** | ❌ | Throttler key is the IP. Plan: tracker = user id when authenticated (XS) |
| Postgres row-level security for org data | ❌ | Scoping is done in services. Plan: `app.org_id`/`app.user_id` GUCs set per request, plus RLS policies on org-owned tables (subscriptions, api_keys, org users) (M) |
| Secrets in a cloud secret manager | ✅ | AWS Secrets Manager + External Secrets in Terraform/Helm |
| Column-level PII encryption (phone, email) | ❌ | Only TOTP secrets and MoMo numbers are encrypted. Plan: AES-GCM columns + HMAC blind index for lookups and uniqueness. Touches auth, SMS and messaging (M–L) |
| `audit_log` for every admin write | 🟡 | Admin CMS, users, moderation, disputes, payouts ✅. Still needed: a sweep that confirms every `@Roles("admin"…)` write records an entry, enforced by a test (S) |
| OWASP ASVS L2 mapping | ❌ | Write `docs/asvs.md` mapping controls to code (S) |
| Dependency and container scanning in CI | ❌ | Plan: `pnpm audit` / OSV-Scanner, pip-audit, Trivy on images (S) |

## Privacy
| Requirement | Status | Notes |
|---|---|---|
| Consent records | ✅ | Append-only ledger |
| Deletion endpoint | ✅ | 30-day grace, then hard delete, or an anonymised tombstone when financial records exist |
| **Data export (JSON)** | ❌ | Plan: `POST /v1/me/export` → async job → signed URL (S) |
| Regional residency (eu, africa-west, americas) | ❌ | Terraform is single-region. Plan: one stack per jurisdiction; only anonymised price aggregates replicate globally (M) |
| `docs/compliance.md` (GDPR + Ghana Act 843) | ❌ | (S) |

## Performance
| Requirement | Status | Notes |
|---|---|---|
| p95 < 300 ms at 500 RPS per region | ❓ | Never measured. Needs the k6 script plus a seeded stack |
| Dashboard from Redis, 60 s TTL, invalidated on new aggregates | 🟡 | Cached for 120 s. Invalidation only runs after forecast refresh. Plan: 60 s TTL + invalidate from the aggregate-refresh job (XS) |

## Observability
| Requirement | Status | Notes |
|---|---|---|
| Request IDs, health/readiness probes | ✅ | |
| Structured JSON logs | 🟡 | Workers use pino; the API uses Nest's default logger. Plan: `nestjs-pino` with request-id binding (XS) |
| OpenTelemetry traces (API, workers, ML) | ❌ | OTLP exporter, auto-instrumentation for http/pg/ioredis/bullmq and FastAPI (M) |
| Prometheus metrics | ❌ | `/metrics` on each service plus business counters (S) |
| Sentry | ❌ | Named in the spec. Needs a DSN from you (S) |
| Data-freshness SLO alerts per country | ❌ | Prometheus gauge for the latest observation age by country, plus alert rules (S) |

## Testing
| Requirement | Status | Notes |
|---|---|---|
| Unit tests | ✅ | 100 API + 14 worker tests (**Vitest**, Jest-compatible API, not Jest itself), 10 ML + 3 pipeline (pytest) |
| Integration tests with Testcontainers (Timescale+PostGIS, Redis) | ❌ | **Highest-value gap: no SQL has run against a database yet** (M) |
| Contract tests validating *responses* against openapi.yaml | 🟡 | CI checks routes, operation IDs and params. Plan: validate every integration-test response with an OpenAPI validator (S) |
| k6 load test | ❌ | (S) |
| ML backtest tests with fixtures | ✅ | |

## DevEx
| Requirement | Status | Notes |
|---|---|---|
| `docker compose up` gives a working stack | 🟡 | Compose runs the dependencies only. Plan: add API, workers, ML and a one-shot migrate+seed service (S) |
| Ghana seed: 16 regions | ✅ | |
| ≥ 50 markets incl. Kumasi Central, Agbogbloshie, **Tamale Central**, Takoradi, Sunyani, Techiman, Bolgatanga, Ho, Cape Coast, Koforidua | 🟡 | 22 markets. Tamale is "Aboabo", not "Tamale Central". Plan: extend to ≥ 50 (district capitals and periodic markets) with approximate coordinates marked for verification (S) |
| Commodities incl. **okra, garden eggs** | 🟡 | 19 tracked. Add okra and garden eggs (XS) |
| 3 years of synthetic seasonal prices, `source=synthetic` | ❌ | Needs a `synthetic` source value (migration) and a generator driven by crop calendars, with a clear flag in API responses and exclusion from the public data API by default (S–M) |

## CI/CD
| Requirement | Status | Notes |
|---|---|---|
| Typecheck, unit tests, spec lint, contract drift, migration round-trip | ✅ | `.github/workflows/ci.yml` |
| ESLint / ruff | ❌ | (XS) |
| Build and push images | ❌ | (S) |
| OpenAPI breaking-change check (fail without a version bump) | ❌ | `oasdiff breaking` against `main` + a check that `info.version` changed (S) |
| Terraform plan | ❌ | (S) |
| Deploy to staging on `main`, manual promotion to production | ❌ | Helm upgrade with a GitHub environment approval gate (S) |

## Docs
| Doc | Status |
|---|---|
| `docs/architecture.md`, `docs/data-model.md`, `docs/state-machines.md` | ✅ written for review |
| `docs/runbook.md`, `docs/compliance.md` | ❌ |
| OpenAPI at `openapi/openapi.yaml` | ✅ Moved to the repo root |

## Third-party services that need your approval
The spec says to ask before adding a paid service it doesn't name. These are in the build today:

| Service | Where | Status |
|---|---|---|
| **Timescale Cloud** (managed Postgres) | `infra/terraform/main.tf` | Chosen because RDS doesn't offer TimescaleDB. The free alternative is self-hosting `timescaledb-ha` on EKS (more ops work) |
| **KYC provider** (e.g. Smile ID, Youverify) | `KYC_PROVIDER_URL` adapter hook | None chosen. Without one, KYC goes to manual review |
| **Helpdesk** (e.g. Zendesk, Freshdesk, Chatwoot) | `HELPDESK_WEBHOOK_URL` | None chosen. Chatwoot can be self-hosted for free |
| ExchangeRate-API (open access) | FX flow | Free tier, attribution required |
| Gotenberg, ClamAV, MLflow, Meilisearch | self-hosted | Open source, no licence cost |
