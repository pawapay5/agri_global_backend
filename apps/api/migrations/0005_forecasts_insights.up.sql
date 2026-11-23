CREATE TABLE model_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,          -- e.g. "price-quantile-lgbm"
  version        text NOT NULL,          -- e.g. "2026.11.23-1"
  mlflow_run_id  text,
  algorithm      text NOT NULL,          -- lightgbm | xgboost | ensemble
  feature_names  text[] NOT NULL,
  params         jsonb NOT NULL DEFAULT '{}',
  metrics        jsonb NOT NULL DEFAULT '{}', -- global backtest metrics
  status         text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','production','archived')),
  trained_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);
CREATE UNIQUE INDEX model_versions_one_production ON model_versions (name) WHERE status = 'production';

-- Per-series, per-horizon walk-forward backtest results.
CREATE TABLE backtest_metrics (
  model_version_id  uuid NOT NULL REFERENCES model_versions(id) ON DELETE CASCADE,
  commodity_id      uuid NOT NULL REFERENCES commodities(id),
  market_id         uuid REFERENCES markets(id),
  region_id         uuid REFERENCES regions(id),
  price_type        text NOT NULL,
  horizon_months    smallint NOT NULL CHECK (horizon_months IN (1,3,6)),
  mape              real NOT NULL CHECK (mape >= 0),
  coverage_p10_p90  real,               -- share of actuals inside [p10,p90]
  n_folds           int NOT NULL
);
CREATE UNIQUE INDEX backtest_metrics_uq ON backtest_metrics (
  model_version_id, commodity_id,
  coalesce(market_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(region_id, '00000000-0000-0000-0000-000000000000'::uuid),
  price_type, horizon_months);

CREATE TABLE forecast_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version_id    uuid NOT NULL REFERENCES model_versions(id),
  commodity_id        uuid NOT NULL REFERENCES commodities(id),
  market_id           uuid REFERENCES markets(id),
  region_id           uuid REFERENCES regions(id),
  country_iso2        char(2) NOT NULL REFERENCES countries(iso2),
  price_type          text NOT NULL CHECK (price_type IN ('retail','wholesale','farm_gate')),
  as_of_date          date NOT NULL,
  currency            char(3) NOT NULL,
  latest_actual_kg_local numeric(18,6),
  is_latest           boolean NOT NULL DEFAULT true,
  generated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (market_id IS NOT NULL OR region_id IS NOT NULL)
);
CREATE UNIQUE INDEX forecast_runs_latest_uq ON forecast_runs (
  commodity_id,
  coalesce(market_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(region_id, '00000000-0000-0000-0000-000000000000'::uuid),
  price_type) WHERE is_latest;

-- All values are per kg in local currency; API converts for display.
CREATE TABLE forecast_points (
  forecast_id         uuid NOT NULL REFERENCES forecast_runs(id) ON DELETE CASCADE,
  horizon_months      smallint NOT NULL CHECK (horizon_months IN (1,3,6)),
  target_date         date NOT NULL,
  p10                 numeric(18,6) NOT NULL,
  p50                 numeric(18,6) NOT NULL,
  p90                 numeric(18,6) NOT NULL,
  backtest_mape       real,
  interval_width_pct  real NOT NULL,
  confidence          text NOT NULL CHECK (confidence IN ('high','medium','low')),
  PRIMARY KEY (forecast_id, horizon_months),
  CHECK (p10 <= p50 AND p50 <= p90)
);

CREATE TABLE forecast_explanations (
  forecast_id     uuid NOT NULL REFERENCES forecast_runs(id) ON DELETE CASCADE,
  horizon_months  smallint NOT NULL,
  base_value      double precision NOT NULL,
  -- [{feature, i18nKey, value, contribution, sharePct, direction}] top 7 by |contribution|
  features        jsonb NOT NULL,
  insight_key     text NOT NULL,
  insight_params  jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (forecast_id, horizon_months)
);

CREATE TABLE export_prices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id       uuid NOT NULL REFERENCES commodities(id),
  origin_iso2        char(2) NOT NULL REFERENCES countries(iso2),
  destination        text NOT NULL,
  period             date NOT NULL,   -- first day of month
  price_usd_per_kg   numeric(18,6) NOT NULL,
  volume_tonnes      numeric(18,3),
  source             text NOT NULL,
  UNIQUE (commodity_id, origin_iso2, destination, period, source)
);

CREATE TABLE export_requirements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination   text NOT NULL,
  commodity_id  uuid REFERENCES commodities(id) ON DELETE CASCADE,
  category_id   uuid REFERENCES commodity_categories(id) ON DELETE CASCADE,
  code          text NOT NULL,
  title         jsonb NOT NULL,
  description   jsonb NOT NULL DEFAULT '{}',
  mandatory     boolean NOT NULL DEFAULT true,
  authority     text,
  url           text,
  sort_order    int NOT NULL DEFAULT 0
);
CREATE INDEX export_requirements_dest_idx ON export_requirements (destination);

-- Weather → advice rules, per country pack (e.g. fall armyworm after warm humid spells).
CREATE TABLE agro_advice_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso2   char(2) REFERENCES countries(iso2),
  commodity_id   uuid REFERENCES commodities(id) ON DELETE CASCADE,
  code           text NOT NULL,
  severity       text NOT NULL CHECK (severity IN ('info','warning','critical')),
  -- {"all":[{"metric":"precip_sum_3d","op":">=","value":50}, ...]}
  condition      jsonb NOT NULL,
  months         smallint[] NOT NULL DEFAULT '{}',
  i18n_key       text NOT NULL,
  active         boolean NOT NULL DEFAULT true,
  UNIQUE (country_iso2, code)
);
