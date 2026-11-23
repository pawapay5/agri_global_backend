-- Exogenous features for forecasting, loaded by pipelines/ from real sources.

-- Monthly weather per region (Open-Meteo historical archive / ERA5 at the region centroid).
CREATE TABLE weather_monthly (
  region_id           uuid NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  month               date NOT NULL,             -- first day of month
  precip_mm           real NOT NULL,
  precip_normal_mm    real,                      -- same-month mean over the reference period
  temp_mean_c         real NOT NULL,
  source              text NOT NULL,
  PRIMARY KEY (region_id, month)
);

-- Country-level monthly macro indicators (e.g. fuel_pump_price, cpi_food).
CREATE TABLE macro_monthly (
  country_iso2  char(2) NOT NULL REFERENCES countries(iso2),
  indicator     text NOT NULL,
  month         date NOT NULL,
  value         double precision NOT NULL,
  source        text NOT NULL,
  PRIMARY KEY (country_iso2, indicator, month)
);

-- Pipeline run log (Prefect writes one row per flow run for operational visibility).
CREATE TABLE pipeline_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow         text NOT NULL,
  country_iso2 char(2),
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed')),
  stats        jsonb NOT NULL DEFAULT '{}',
  error        text
);
CREATE INDEX pipeline_runs_flow_idx ON pipeline_runs (flow, started_at DESC);
