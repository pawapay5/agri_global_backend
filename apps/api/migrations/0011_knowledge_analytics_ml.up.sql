-- migrate:no-transaction
-- Knowledge base, seller analytics (hypertable + continuous aggregates), forecast guardrails, model cards.

-- ── roles: agronomists sign off agronomic content ──
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('farmer','trader','consumer','researcher','student','policymaker','enumerator','agronomist','admin','org_admin'));

-- ── knowledge (localised: jsonb {locale: text}; versioned via knowledge_revisions) ──
CREATE TABLE knowledge_revisions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity      text NOT NULL,
  entity_id   uuid NOT NULL,
  version     int NOT NULL,
  data        jsonb NOT NULL,
  edited_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_revisions_entity_idx ON knowledge_revisions (entity, entity_id, version DESC);

-- Snapshot the previous row on every update and bump the version; edits invalidate agronomist sign-off.
CREATE OR REPLACE FUNCTION knowledge_versioning() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO knowledge_revisions (entity, entity_id, version, data) VALUES (TG_TABLE_NAME, OLD.id, OLD.version, to_jsonb(OLD));
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  IF TG_TABLE_NAME IN ('fertiliser_rules','pest_diseases','crop_guides')
     AND (NEW.reviewed_by IS NOT DISTINCT FROM OLD.reviewed_by) AND (NEW.reviewed_at IS NOT DISTINCT FROM OLD.reviewed_at) THEN
    NEW.reviewed_by := NULL; NEW.reviewed_at := NULL;
    IF NEW.status = 'published' AND TG_TABLE_NAME = 'fertiliser_rules' THEN NEW.status := 'draft'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE crop_guides (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso2   char(2) NOT NULL REFERENCES countries(iso2),
  commodity_id   uuid NOT NULL REFERENCES commodities(id),
  title          jsonb NOT NULL,
  summary        jsonb NOT NULL DEFAULT '{}',
  -- [{"key": "land_preparation", "title": {...}, "body": {...markdown}}]
  sections       jsonb NOT NULL DEFAULT '[]',
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  version        int NOT NULL DEFAULT 1,
  reviewed_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at    timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_iso2, commodity_id)
);
CREATE TRIGGER crop_guides_versioning BEFORE UPDATE ON crop_guides FOR EACH ROW EXECUTE FUNCTION knowledge_versioning();

CREATE TABLE pest_diseases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso2    char(2) REFERENCES countries(iso2),          -- NULL = applies everywhere
  kind            text NOT NULL CHECK (kind IN ('pest','disease','weed','deficiency')),
  name            jsonb NOT NULL,
  scientific_name text,
  commodity_ids   uuid[] NOT NULL DEFAULT '{}',
  symptoms        jsonb NOT NULL DEFAULT '{}',
  photos          jsonb NOT NULL DEFAULT '[]',                 -- [{variants:{...}, caption:{...}, credit:"..."}]
  organic_control jsonb NOT NULL DEFAULT '{}',
  chemical_control jsonb NOT NULL DEFAULT '{}',                -- active ingredients registered in the country; PPE + PHI in text
  prevention      jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  version         int NOT NULL DEFAULT 1,
  reviewed_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  search          tsvector GENERATED ALWAYS AS (to_tsvector('simple', immutable_unaccent(jsonb_text_values(name) || ' ' || coalesce(scientific_name, '') || ' ' || jsonb_text_values(symptoms)))) STORED
);
CREATE INDEX pest_diseases_search_idx ON pest_diseases USING gin (search);
CREATE INDEX pest_diseases_commodities_idx ON pest_diseases USING gin (commodity_ids);
CREATE TRIGGER pest_diseases_versioning BEFORE UPDATE ON pest_diseases FOR EACH ROW EXECUTE FUNCTION knowledge_versioning();

-- Fertiliser products available in a country (nutrient analysis + bag size are product facts).
CREATE TABLE fertiliser_products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso2  char(2) NOT NULL REFERENCES countries(iso2),
  code          text NOT NULL,
  name          jsonb NOT NULL,
  n_pct         numeric(5,2) NOT NULL DEFAULT 0,
  p2o5_pct      numeric(5,2) NOT NULL DEFAULT 0,
  k2o_pct       numeric(5,2) NOT NULL DEFAULT 0,
  s_pct         numeric(5,2) NOT NULL DEFAULT 0,
  bag_kg        numeric(8,2) NOT NULL CHECK (bag_kg > 0),
  organic       boolean NOT NULL DEFAULT false,
  UNIQUE (country_iso2, code)
);

-- Agronomic recommendations. Served only when status = 'published' AND reviewed by an agronomist.
CREATE TABLE fertiliser_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso2    char(2) NOT NULL REFERENCES countries(iso2),
  commodity_id    uuid NOT NULL REFERENCES commodities(id),
  region_id       uuid REFERENCES regions(id),                -- NULL = national
  farming_type    text CHECK (farming_type IN ('subsistence','commercial','mixed','organic','irrigated','rainfed')),
  -- [{"stage": "basal", "productCode": "npk_15_15_15", "rateKgPerHa": 250, "timing": {...locale text}, "method": {...}}]
  applications    jsonb NOT NULL,
  notes           jsonb NOT NULL DEFAULT '{}',
  source          text NOT NULL,                              -- citation for the recommendation
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  version         int NOT NULL DEFAULT 1,
  reviewed_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'published' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX fertiliser_rules_uq ON fertiliser_rules (country_iso2, commodity_id, coalesce(region_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(farming_type, '*')) WHERE status <> 'archived';
CREATE TRIGGER fertiliser_rules_versioning BEFORE UPDATE ON fertiliser_rules FOR EACH ROW EXECUTE FUNCTION knowledge_versioning();

CREATE TABLE programmes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso2   char(2) NOT NULL REFERENCES countries(iso2),
  kind           text NOT NULL CHECK (kind IN ('government_programme','grant','subsidy','loan','insurance')),
  title          jsonb NOT NULL,
  body           jsonb NOT NULL DEFAULT '{}',
  agency         text,
  eligibility    jsonb NOT NULL DEFAULT '{}',
  commodity_ids  uuid[] NOT NULL DEFAULT '{}',
  region_ids     uuid[] NOT NULL DEFAULT '{}',
  opens_at       date,
  closes_at      date,
  url            text,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  version        int NOT NULL DEFAULT 1,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER programmes_versioning BEFORE UPDATE ON programmes FOR EACH ROW EXECUTE FUNCTION knowledge_versioning();

CREATE TABLE training_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso2   char(2) REFERENCES countries(iso2),
  kind           text NOT NULL CHECK (kind IN ('article','event','video','course')),
  title          jsonb NOT NULL,
  body           jsonb NOT NULL DEFAULT '{}',
  commodity_ids  uuid[] NOT NULL DEFAULT '{}',
  starts_at      timestamptz,
  ends_at        timestamptz,
  venue          text,
  region_id      uuid REFERENCES regions(id),
  location       geography(Point, 4326),
  url            text,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  version        int NOT NULL DEFAULT 1,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'event' OR starts_at IS NOT NULL)
);
CREATE TRIGGER training_items_versioning BEFORE UPDATE ON training_items FOR EACH ROW EXECUTE FUNCTION knowledge_versioning();

CREATE TABLE input_suppliers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso2   char(2) NOT NULL REFERENCES countries(iso2),
  name           text NOT NULL,
  categories     text[] NOT NULL CHECK (categories <@ ARRAY['seed','fertiliser','agrochemical','equipment','feed','veterinary','irrigation','packaging']),
  description    jsonb NOT NULL DEFAULT '{}',
  region_id      uuid REFERENCES regions(id),
  location       geography(Point, 4326),
  phone          text,
  whatsapp       text,
  website        text,
  verified       boolean NOT NULL DEFAULT false,               -- e.g. registered agro-input dealer
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL, -- linked marketplace seller, if any
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  version        int NOT NULL DEFAULT 1,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX input_suppliers_location_idx ON input_suppliers USING gist (location);
CREATE TRIGGER input_suppliers_versioning BEFORE UPDATE ON input_suppliers FOR EACH ROW EXECUTE FUNCTION knowledge_versioning();

-- Public holidays (computed from country-pack rules by the seeder; announced dates added by admins).
CREATE TABLE holidays (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso2  char(2) NOT NULL REFERENCES countries(iso2),
  day           date NOT NULL,
  name          jsonb NOT NULL,
  UNIQUE (country_iso2, day)
);

-- ── forecasting guardrails + model cards ──
ALTER TABLE forecast_runs ADD COLUMN status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','insufficient_data'));
ALTER TABLE forecast_runs ADD COLUMN suppression jsonb NOT NULL DEFAULT '{}';  -- {"run": ["stale_data"], "6": "backtest_mape_above_25"}
ALTER TABLE forecast_runs ADD COLUMN history_weeks int;
ALTER TABLE forecast_runs ADD COLUMN last_observed_at date;
ALTER TABLE model_versions ADD COLUMN model_card jsonb NOT NULL DEFAULT '{}';
ALTER TABLE model_versions ADD COLUMN baseline_metrics jsonb NOT NULL DEFAULT '{}';
ALTER TABLE backtest_metrics ADD COLUMN smape real;
ALTER TABLE backtest_metrics ADD COLUMN baseline_mape real;

ALTER TABLE report_jobs DROP CONSTRAINT IF EXISTS report_jobs_type_check;
ALTER TABLE report_jobs ADD CONSTRAINT report_jobs_type_check CHECK (type IN ('crop_price','market_analysis','forecast','regional','custom','seller_performance'));

-- ── marketplace activity (hypertable) → continuous aggregates ──
CREATE TABLE marketplace_events (
  at            timestamptz NOT NULL DEFAULT now(),
  kind          text NOT NULL CHECK (kind IN ('listing_view','favourite','offer','order_placed','order_completed','order_cancelled')),
  seller_id     uuid NOT NULL,
  buyer_id      uuid,
  listing_id    uuid,
  order_id      uuid,
  commodity_id  uuid,
  region_id     uuid,
  country_iso2  char(2) NOT NULL,
  currency      char(3),
  quantity_kg   numeric(18,3),
  amount        numeric(18,2),
  order_head    boolean NOT NULL DEFAULT false   -- exactly one row per order and kind, so caggs can count orders without DISTINCT
);
SELECT create_hypertable('marketplace_events', by_range('at', INTERVAL '30 days'));
CREATE INDEX marketplace_events_seller_idx ON marketplace_events (seller_id, at DESC);
CREATE INDEX marketplace_events_commodity_idx ON marketplace_events (country_iso2, commodity_id, at DESC);

-- Order lifecycle → events (one per order and kind; listing views and offers are written by the API).
CREATE OR REPLACE FUNCTION marketplace_order_events() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text;
BEGIN
  IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN k := 'order_completed';
  ELSIF NEW.status IN ('cancelled','refunded') AND OLD.status NOT IN ('cancelled','refunded') THEN k := 'order_cancelled';
  ELSE RETURN NEW; END IF;
  INSERT INTO marketplace_events (at, kind, seller_id, buyer_id, listing_id, order_id, commodity_id, region_id, country_iso2, currency, quantity_kg, amount, order_head)
  SELECT now(), k, NEW.seller_id, NEW.buyer_id, oi.listing_id, NEW.id, l.commodity_id, l.region_id, NEW.country_iso2, NEW.currency,
         CASE WHEN l.price_per_kg_local > 0 THEN round(oi.line_total / l.price_per_kg_local, 3) END,
         CASE WHEN k = 'order_cancelled' THEN NULL ELSE oi.line_total END,
         row_number() OVER (ORDER BY oi.listing_id) = 1
  FROM order_items oi JOIN listings l ON l.id = oi.listing_id WHERE oi.order_id = NEW.id;
  -- 'order_placed' is emitted per item by the order_items trigger (items are inserted after the order row).
  RETURN NEW;
END $$;
CREATE TRIGGER orders_marketplace_events AFTER UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION marketplace_order_events();

CREATE OR REPLACE FUNCTION marketplace_item_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO marketplace_events (at, kind, seller_id, buyer_id, listing_id, order_id, commodity_id, region_id, country_iso2, currency, quantity_kg, amount, order_head)
  SELECT now(), 'order_placed', o.seller_id, o.buyer_id, NEW.listing_id, o.id, l.commodity_id, l.region_id, o.country_iso2, o.currency,
         CASE WHEN l.price_per_kg_local > 0 THEN round(NEW.line_total / l.price_per_kg_local, 3) END, NEW.line_total,
         NOT EXISTS (SELECT 1 FROM marketplace_events e WHERE e.order_id = o.id AND e.kind = 'order_placed')
  FROM orders o JOIN listings l ON l.id = NEW.listing_id WHERE o.id = NEW.order_id;
  RETURN NEW;
END $$;
CREATE TRIGGER order_items_marketplace_events AFTER INSERT ON order_items FOR EACH ROW EXECUTE FUNCTION marketplace_item_events();

CREATE MATERIALIZED VIEW seller_daily
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket(INTERVAL '1 day', at) AS bucket, seller_id, currency,
       count(*) FILTER (WHERE kind = 'listing_view')     AS views,
       count(*) FILTER (WHERE kind = 'favourite')        AS favourites,
       count(*) FILTER (WHERE kind = 'offer')            AS offers,
       count(*) FILTER (WHERE kind = 'order_placed' AND order_head)    AS orders_placed,
       count(*) FILTER (WHERE kind = 'order_completed' AND order_head) AS orders_completed,
       count(*) FILTER (WHERE kind = 'order_cancelled' AND order_head) AS orders_cancelled,
       coalesce(sum(amount) FILTER (WHERE kind = 'order_completed'), 0)       AS revenue,
       coalesce(sum(quantity_kg) FILTER (WHERE kind = 'order_completed'), 0)  AS kg_sold
FROM marketplace_events GROUP BY 1, 2, 3 WITH NO DATA;
SELECT add_continuous_aggregate_policy('seller_daily', start_offset => INTERVAL '35 days', end_offset => INTERVAL '5 minutes', schedule_interval => INTERVAL '15 minutes');

CREATE MATERIALIZED VIEW listing_daily
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket(INTERVAL '1 day', at) AS bucket, seller_id, listing_id, commodity_id,
       count(*) FILTER (WHERE kind = 'listing_view') AS views,
       count(*) FILTER (WHERE kind = 'offer')        AS offers,
       count(*) FILTER (WHERE kind = 'order_placed') AS orders,
       coalesce(sum(amount) FILTER (WHERE kind = 'order_completed'), 0) AS revenue,
       coalesce(sum(quantity_kg) FILTER (WHERE kind = 'order_completed'), 0) AS kg_sold
FROM marketplace_events WHERE listing_id IS NOT NULL GROUP BY 1, 2, 3, 4 WITH NO DATA;
SELECT add_continuous_aggregate_policy('listing_daily', start_offset => INTERVAL '35 days', end_offset => INTERVAL '5 minutes', schedule_interval => INTERVAL '15 minutes');

CREATE MATERIALIZED VIEW demand_weekly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket(INTERVAL '1 week', at) AS bucket, country_iso2, commodity_id, region_id,
       count(*) FILTER (WHERE kind = 'listing_view') AS views,
       count(*) FILTER (WHERE kind = 'favourite')    AS favourites,
       count(*) FILTER (WHERE kind = 'offer')        AS offers,
       count(*) FILTER (WHERE kind = 'order_placed') AS orders,
       coalesce(sum(quantity_kg) FILTER (WHERE kind = 'order_placed'), 0) AS kg_ordered
FROM marketplace_events WHERE commodity_id IS NOT NULL GROUP BY 1, 2, 3, 4 WITH NO DATA;
SELECT add_continuous_aggregate_policy('demand_weekly', start_offset => INTERVAL '120 days', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '1 hour');

-- Daily snapshot of listed supply (quantity is state, so it's sampled into a hypertable by the workers).
CREATE TABLE supply_snapshots (
  at            timestamptz NOT NULL,
  country_iso2  char(2) NOT NULL,
  commodity_id  uuid NOT NULL,
  region_id     uuid,
  listings      int NOT NULL,
  sellers       int NOT NULL,
  quantity_kg   numeric(18,3) NOT NULL
);
SELECT create_hypertable('supply_snapshots', by_range('at', INTERVAL '90 days'));
CREATE UNIQUE INDEX supply_snapshots_uq ON supply_snapshots (at, country_iso2, commodity_id, coalesce(region_id, '00000000-0000-0000-0000-000000000000'::uuid));
