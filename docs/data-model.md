# Data model

PostgreSQL 16 with TimescaleDB and PostGIS. DDL lives in reversible SQL migrations (`apps/api/migrations/NNNN_*.up.sql`
and `.down.sql`). The diagrams show keys and the columns that matter for understanding. See the migrations for everything else.

**Hypertables:** `price_observations`, `audit_log`, `marketplace_events`, `supply_snapshots`.
**Continuous aggregates:** `price_daily` → `price_weekly` (hierarchical), `seller_daily`, `listing_daily`, `demand_weekly`.

## 1. Reference data and geography (country packs)

```mermaid
erDiagram
  currencies ||--o{ countries : "local currency"
  countries ||--o{ regions : has
  regions ||--o{ regions : parent
  countries ||--o{ markets : has
  regions ||--o{ markets : contains
  commodity_categories ||--o{ commodities : groups
  units ||--o{ commodities : "default unit"
  commodities ||--o{ varieties : has
  commodities ||--o{ commodity_country_profiles : "tracked in"
  countries ||--o{ commodity_country_profiles : tracks
  commodities ||--o{ commodity_unit_conversions : "kg per unit"
  commodities ||--o{ crop_calendars : seasons
  currencies ||--o{ fx_rates : base
  countries ||--o{ data_sources : "price sources"
  countries ||--o{ holidays : has

  countries { char2 iso2 PK "config jsonb: timeouts, limits, sms keywords" }
  regions { uuid id PK "geom MultiPolygon, centroid, level" }
  markets { uuid id PK "location geography(Point), type, aliases" }
  commodities { uuid id PK "code, hs_code, perishability, name jsonb" }
  commodity_unit_conversions { uuid id PK "unit_code, country_iso2 nullable, kg_factor" }
  fx_rates { uuid id PK "base, quote=USD, rate, rate_date" }
  crop_calendars { uuid id PK "region_id nullable, planting/harvest/lean months" }
```

## 2. Identity, preferences, consent and audit

```mermaid
erDiagram
  users ||--o{ oauth_identities : links
  users ||--o{ devices : registers
  users ||--o{ refresh_tokens : "sessions"
  devices ||--o{ refresh_tokens : bound
  users ||--o{ recovery_codes : "TOTP backup"
  users ||--|| user_preferences : has
  users ||--|| farming_profiles : has
  users ||--|| user_interests : has
  users ||--o{ saved_locations : saves
  users ||--o{ consents : "append-only ledger"
  organisations ||--o{ users : members

  users { uuid id PK "email citext, phone, role, country_iso2, totp_secret_enc, deletion_scheduled_at, suspended_at" }
  refresh_tokens { uuid id PK "family_id, token_hash sha256, used_at, revoked_at" }
  consents { bigint id PK "type, granted, version, ip, created_at" }
  audit_log { uuid id "hypertable on at; actor_id, action, entity, data" }
```

## 3. Prices, forecasts and insights

```mermaid
erDiagram
  markets ||--o{ price_observations : "observed at"
  commodities ||--o{ price_observations : "of"
  fx_rates ||--o{ price_observations : "normalised with"
  price_import_batches ||--o{ price_observations : "imported in"
  data_sources ||--o{ price_observations : "from"
  model_versions ||--o{ forecast_runs : produced
  model_versions ||--o{ backtest_metrics : evaluated
  forecast_runs ||--o{ forecast_points : "1/3/6 months"
  forecast_runs ||--o{ forecast_explanations : "SHAP top 7"
  regions ||--o{ weather_monthly : weather

  price_observations {
    timestamptz observed_at PK "hypertable"
    uuid id PK
    numeric amount "as observed, with currency + unit_code"
    numeric price_per_kg_local "normalised"
    numeric price_per_kg_usd "normalised"
    uuid fx_rate_id
    text status "pending|approved|flagged|rejected"
    real outlier_score "rolling MAD z"
  }
  forecast_runs { uuid id PK "status available|insufficient_data, suppression jsonb, is_latest" }
  forecast_points { uuid forecast_id PK "horizon_months PK, p10/p50/p90, backtest_mape, confidence" }
  model_versions { uuid id PK "status, metrics, baseline_metrics, model_card" }
```

Also: `price_daily` / `price_weekly` (CAGGs), `aggregate_watermarks`, `macro_monthly`, `export_prices`,
`export_requirements`, `agro_advice_rules`, `pipeline_runs`.

## 4. Alerts, notifications, content, support, platform

```mermaid
erDiagram
  users ||--o{ alerts : sets
  alerts ||--o{ alert_events : "fires (dedupe_key unique)"
  users ||--o{ notifications : inbox
  notifications ||--o{ notification_deliveries : "per channel"
  users ||--|| notification_preferences : has
  notification_templates }o--|| notification_templates : "key × channel × locale"
  users ||--o{ report_jobs : requests
  report_jobs ||--o| short_links : shares
  plans ||--o{ subscriptions : "plan"
  users ||--o{ subscriptions : "personal"
  organisations ||--o{ subscriptions : "org plan"
  users ||--o{ api_keys : owns
  api_keys ||--o{ api_usage_daily : usage
  users ||--o{ support_tickets : opens
  support_tickets ||--o{ support_messages : thread

  alerts { uuid id PK "condition, threshold_per_kg_local, channels, cooldown, last_state" }
  subscriptions { uuid id PK "provider, provider_ref unique, status, current_period_end" }
  webhook_events { text provider PK "event_id PK, processed_at (idempotency)" }
```

Also: `feedback`, `issue_reports`, `success_stories`, `faqs`, `help_articles`, `app_config`, `sms_inbound`.

## 5. Marketplace, payments and ledger

```mermaid
erDiagram
  users ||--o| seller_profiles : "is seller"
  seller_profiles ||--o{ listings : lists
  listings ||--o{ listing_photos : "≤5"
  listings ||--o{ offers : negotiated
  offers ||--o{ offers : "counter"
  users ||--o{ cart_items : cart
  users ||--o{ checkouts : checks_out
  checkouts ||--o{ orders : "one per seller"
  orders ||--o{ order_items : contains
  orders ||--o{ order_events : history
  orders ||--o{ payments : paid_by
  orders ||--o| disputes : may_have
  disputes ||--o{ dispute_evidence : evidence
  orders ||--o{ reviews : "after completed"
  users ||--o{ payment_methods : "PSP tokens"
  users ||--o{ payout_accounts : "recipient tokens"
  payout_accounts ||--o{ payouts : receives
  ledger_transactions ||--|{ ledger_entries : "balanced"
  ledger_accounts ||--o{ ledger_entries : posts

  orders { uuid id PK "status (state machine), version, state_deadline_at, subtotal, delivery_fee, commission, total" }
  payments { uuid id PK "provider, reference unique, status, refunded, payer_msisdn_enc" }
  ledger_transactions { uuid id PK "kind, reference unique (idempotency)" }
  ledger_entries { bigint id PK "direction, amount > 0 (immutable)" }
  ledger_accounts { uuid id PK "code unique, kind, normal side" }
```

Also: `commission_rules`, `reconciliation_runs`, view `ledger_balances`.

## 6. Messaging, moderation, community

```mermaid
erDiagram
  conversations ||--|{ conversation_members : members
  conversations ||--o{ messages : contains
  conversations }o--o| listings : about
  conversations }o--o| orders : about
  users ||--o{ user_blocks : blocks
  users ||--o{ posts : writes
  posts ||--o{ comments : threaded
  comments ||--o{ comments : replies
  posts ||--o{ reactions : receives
  users ||--o{ follows : follows
  users ||--o{ reputation_events : earns
  badges ||--o{ user_badges : awarded
  posts }o--o| price_observations : "price_update → crowd observation"

  messages { uuid id PK "kind text|image|offer|system, flags (scam_*), client_id" }
  moderation_items { uuid id PK "target_type, target_id, reporter_id nullable = automatic, status" }
```

## 7. Knowledge and seller analytics

```mermaid
erDiagram
  commodities ||--o| crop_guides : "per country"
  commodities ||--o{ fertiliser_rules : "per country/region"
  fertiliser_products ||--o{ fertiliser_rules : "referenced by code"
  users ||--o{ fertiliser_rules : "agronomist review"
  knowledge_revisions }o--|| crop_guides : "versions (trigger)"
  seller_profiles ||--o{ marketplace_events : activity

  fertiliser_rules { uuid id PK "applications jsonb, source, status, reviewed_by/at (required to publish)" }
  marketplace_events { timestamptz at "hypertable; kind, seller_id, listing_id, order_id, amount, order_head" }
  supply_snapshots { timestamptz at "hypertable; commodity, region, quantity_kg" }
```

Also: `pest_diseases`, `programmes`, `training_items`, `input_suppliers`.

## Conventions
- UUID v4 primary keys (`gen_random_uuid()`). Hypertables include the time column in their primary or unique keys.
- Money is `numeric`. The API returns decimals as strings.
- Localised text is `jsonb {locale: text}` with fallback exact → language → `en`.
- Soft state uses `status` columns. Hard deletes happen only for account purge (financial records keep an anonymised tombstone user).
