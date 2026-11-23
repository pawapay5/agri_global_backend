-- migrate:no-transaction
-- (continuous aggregates and their policies must be created outside a transaction block)

CREATE TABLE price_import_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso2  char(2) NOT NULL REFERENCES countries(iso2),
  source_id     uuid REFERENCES data_sources(id),
  uploaded_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  filename      text,
  object_key    text,
  dry_run       boolean NOT NULL DEFAULT false,
  total_rows    int NOT NULL DEFAULT 0,
  accepted      int NOT NULL DEFAULT 0,
  flagged       int NOT NULL DEFAULT 0,
  rejected      int NOT NULL DEFAULT 0,
  errors        jsonb NOT NULL DEFAULT '[]',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE price_observations (
  observed_at           timestamptz NOT NULL,
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  commodity_id          uuid NOT NULL REFERENCES commodities(id),
  variety_id            uuid REFERENCES varieties(id),
  market_id             uuid NOT NULL REFERENCES markets(id),
  country_iso2          char(2) NOT NULL REFERENCES countries(iso2),
  region_id             uuid REFERENCES regions(id),
  price_type            text NOT NULL CHECK (price_type IN ('retail','wholesale','farm_gate')),
  -- as observed
  amount                numeric(18,4) NOT NULL CHECK (amount > 0),
  currency              char(3) NOT NULL REFERENCES currencies(code),
  unit_code             text NOT NULL REFERENCES units(code),
  kg_per_unit           numeric(18,6) NOT NULL CHECK (kg_per_unit > 0),
  -- normalised
  price_per_kg_local    numeric(18,6) NOT NULL,
  price_per_kg_usd      numeric(18,6) NOT NULL,
  fx_rate_id            uuid REFERENCES fx_rates(id),
  quality               text CHECK (quality IN ('low','medium','high')),
  source                text NOT NULL CHECK (source IN ('source_pull','crowd','admin_csv','enumerator')),
  source_id             uuid REFERENCES data_sources(id),
  source_ref            text,                 -- upstream record id for idempotent pulls
  submitted_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  import_batch_id       uuid REFERENCES price_import_batches(id),
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','flagged','rejected')),
  outlier_score         real,
  flags                 text[] NOT NULL DEFAULT '{}',
  reviewed_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at           timestamptz,
  review_reason         text,
  location              geography(Point, 4326),
  note                  text,
  idempotency_key       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, observed_at)
);
SELECT create_hypertable('price_observations', by_range('observed_at', INTERVAL '30 days'));

CREATE INDEX price_obs_series_idx ON price_observations (commodity_id, market_id, price_type, observed_at DESC) WHERE status = 'approved';
CREATE INDEX price_obs_country_idx ON price_observations (country_iso2, commodity_id, price_type, observed_at DESC) WHERE status = 'approved';
CREATE INDEX price_obs_review_idx ON price_observations (status, country_iso2, created_at) WHERE status IN ('pending','flagged');
CREATE INDEX price_obs_created_idx ON price_observations (created_at);
CREATE INDEX price_obs_submitter_idx ON price_observations (submitted_by, observed_at DESC) WHERE submitted_by IS NOT NULL;
-- Idempotency: unique indexes on hypertables must include the partitioning column.
CREATE UNIQUE INDEX price_obs_source_ref_uq ON price_observations (source_id, source_ref, observed_at) WHERE source_ref IS NOT NULL;
CREATE UNIQUE INDEX price_obs_idem_uq ON price_observations (submitted_by, idempotency_key, observed_at) WHERE idempotency_key IS NOT NULL;

ALTER TABLE price_observations SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'commodity_id, market_id, price_type',
  timescaledb.compress_orderby = 'observed_at DESC'
);
SELECT add_compression_policy('price_observations', INTERVAL '180 days');

-- ── Continuous aggregates (approved observations only) ──────────────────────
CREATE MATERIALIZED VIEW price_daily
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket(INTERVAL '1 day', observed_at) AS bucket,
  commodity_id,
  market_id,
  price_type,
  country_iso2,
  region_id,
  count(*)                          AS n,
  sum(price_per_kg_local)           AS sum_kg_local,
  avg(price_per_kg_local)           AS avg_kg_local,
  min(price_per_kg_local)           AS min_kg_local,
  max(price_per_kg_local)           AS max_kg_local,
  sum(price_per_kg_usd)             AS sum_kg_usd,
  avg(price_per_kg_usd)             AS avg_kg_usd,
  last(price_per_kg_local, observed_at) AS close_kg_local,
  max(observed_at)                  AS last_observed_at
FROM price_observations
WHERE status = 'approved'
GROUP BY bucket, commodity_id, market_id, price_type, country_iso2, region_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('price_daily',
  start_offset => INTERVAL '120 days',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '15 minutes');

CREATE INDEX price_daily_series_idx ON price_daily (commodity_id, market_id, price_type, bucket DESC);
CREATE INDEX price_daily_country_idx ON price_daily (country_iso2, commodity_id, price_type, bucket DESC);

-- Hierarchical: weekly is rolled up from daily.
CREATE MATERIALIZED VIEW price_weekly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket(INTERVAL '1 week', bucket) AS bucket,
  commodity_id,
  market_id,
  price_type,
  country_iso2,
  region_id,
  sum(n)                              AS n,
  sum(sum_kg_local)                   AS sum_kg_local,
  sum(sum_kg_local) / sum(n)          AS avg_kg_local,
  min(min_kg_local)                   AS min_kg_local,
  max(max_kg_local)                   AS max_kg_local,
  sum(sum_kg_usd)                     AS sum_kg_usd,
  sum(sum_kg_usd) / sum(n)            AS avg_kg_usd,
  last(close_kg_local, bucket)        AS close_kg_local,
  max(last_observed_at)               AS last_observed_at
FROM price_daily
GROUP BY 1, commodity_id, market_id, price_type, country_iso2, region_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('price_weekly',
  start_offset => INTERVAL '180 days',
  end_offset   => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 hour');

CREATE INDEX price_weekly_series_idx ON price_weekly (commodity_id, market_id, price_type, bucket DESC);

-- Watermark used by the alert evaluator so each aggregate change is processed once.
CREATE TABLE aggregate_watermarks (
  name        text PRIMARY KEY,
  processed_until timestamptz NOT NULL
);
INSERT INTO aggregate_watermarks (name, processed_until) VALUES ('alerts', now());
