-- Country packs, geography, catalogue, units, FX. Nothing here is country-specific;
-- every row is loaded from /country-packs/<iso2>/ by the seeder.

CREATE TABLE currencies (
  code         char(3) PRIMARY KEY,
  name         text NOT NULL,
  minor_units  smallint NOT NULL DEFAULT 2
);

CREATE TABLE countries (
  iso2            char(2) PRIMARY KEY CHECK (iso2 = upper(iso2)),
  iso3            char(3) NOT NULL UNIQUE,
  name            jsonb NOT NULL,
  brand_name      text,
  currency        char(3) NOT NULL REFERENCES currencies(code),
  default_locale  text NOT NULL,
  locales         text[] NOT NULL,
  default_unit    text NOT NULL,
  area_unit       text NOT NULL DEFAULT 'ha',
  timezone        text NOT NULL,
  phone_prefix    text,
  region_levels   jsonb NOT NULL DEFAULT '[]',
  bbox            float8[] CHECK (bbox IS NULL OR array_length(bbox, 1) = 4),
  config          jsonb NOT NULL DEFAULT '{}',
  active          boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER countries_updated BEFORE UPDATE ON countries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE regions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso2  char(2) NOT NULL REFERENCES countries(iso2),
  parent_id     uuid REFERENCES regions(id),
  code          text NOT NULL,
  name          jsonb NOT NULL,
  level         smallint NOT NULL CHECK (level BETWEEN 1 AND 4),
  geom          geometry(MultiPolygon, 4326),
  centroid      geography(Point, 4326),
  UNIQUE (country_iso2, code)
);
CREATE INDEX regions_country_level_idx ON regions (country_iso2, level);
CREATE INDEX regions_parent_idx ON regions (parent_id);
CREATE INDEX regions_geom_idx ON regions USING gist (geom);

CREATE TABLE markets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso2    char(2) NOT NULL REFERENCES countries(iso2),
  region_id       uuid REFERENCES regions(id),
  code            text NOT NULL,
  name            jsonb NOT NULL,
  type            text NOT NULL CHECK (type IN ('retail','wholesale','farm_gate','rural_periodic','urban_daily','border','export_hub')),
  location        geography(Point, 4326) NOT NULL,
  operating_days  smallint[] NOT NULL DEFAULT '{}',
  photo_key       text,
  aliases         text[] NOT NULL DEFAULT '{}',   -- names used by upstream sources
  active          boolean NOT NULL DEFAULT true,
  search          tsvector GENERATED ALWAYS AS (to_tsvector('simple', immutable_unaccent(jsonb_text_values(name) || ' ' || code))) STORED,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_iso2, code)
);
CREATE TRIGGER markets_updated BEFORE UPDATE ON markets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX markets_location_idx ON markets USING gist (location);
CREATE INDEX markets_region_idx ON markets (region_id);
CREATE INDEX markets_search_idx ON markets USING gin (search);

CREATE TABLE commodity_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        jsonb NOT NULL,
  icon        text,
  sort_order  int NOT NULL DEFAULT 0
);

CREATE TABLE units (
  code       text PRIMARY KEY,
  name       jsonb NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('mass','volume','count','package')),
  kg_factor  numeric(18,6) CHECK (kg_factor IS NULL OR kg_factor > 0) -- generic kg per unit (mass units only)
);

CREATE TABLE commodities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE,
  category_id      uuid NOT NULL REFERENCES commodity_categories(id),
  name             jsonb NOT NULL,
  hs_code          text,
  perishability    text NOT NULL CHECK (perishability IN ('low','medium','high')),
  shelf_life_days  int,
  default_unit     text NOT NULL REFERENCES units(code),
  image_key        text,
  active           boolean NOT NULL DEFAULT true,
  search           tsvector GENERATED ALWAYS AS (to_tsvector('simple', immutable_unaccent(jsonb_text_values(name) || ' ' || code))) STORED
);
CREATE INDEX commodities_category_idx ON commodities (category_id);
CREATE INDEX commodities_search_idx ON commodities USING gin (search);
CREATE INDEX commodities_name_trgm_idx ON commodities USING gin (immutable_unaccent(jsonb_text_values(name)) gin_trgm_ops);

CREATE TABLE commodity_country_profiles (
  commodity_id      uuid NOT NULL REFERENCES commodities(id) ON DELETE CASCADE,
  country_iso2      char(2) NOT NULL REFERENCES countries(iso2),
  local_names       jsonb NOT NULL DEFAULT '{}',
  major_region_ids  uuid[] NOT NULL DEFAULT '{}',
  aliases           text[] NOT NULL DEFAULT '{}',
  tracked           boolean NOT NULL DEFAULT true,
  PRIMARY KEY (commodity_id, country_iso2)
);

CREATE TABLE crop_calendars (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id     uuid NOT NULL REFERENCES commodities(id) ON DELETE CASCADE,
  country_iso2     char(2) NOT NULL REFERENCES countries(iso2),
  region_id        uuid REFERENCES regions(id),
  planting_months  smallint[] NOT NULL DEFAULT '{}',
  harvest_months   smallint[] NOT NULL DEFAULT '{}',
  lean_months      smallint[] NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX crop_calendars_uq ON crop_calendars (commodity_id, country_iso2, coalesce(region_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE varieties (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id  uuid NOT NULL REFERENCES commodities(id) ON DELETE CASCADE,
  code          text NOT NULL,
  name          jsonb NOT NULL,
  UNIQUE (commodity_id, code)
);

-- Commodity-specific (and optionally country-specific) unit → kg factors,
-- e.g. "bag" of maize in GH = 100 kg, "olonka" = 2.5 kg.
CREATE TABLE commodity_unit_conversions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id  uuid NOT NULL REFERENCES commodities(id) ON DELETE CASCADE,
  unit_code     text NOT NULL REFERENCES units(code),
  country_iso2  char(2) REFERENCES countries(iso2),
  kg_factor     numeric(18,6) NOT NULL CHECK (kg_factor > 0)
);
CREATE UNIQUE INDEX commodity_unit_conversions_uq ON commodity_unit_conversions (commodity_id, unit_code, coalesce(country_iso2, '--'));

-- rate = units of `quote` per 1 unit of `base`. We store LOCAL→USD daily rates.
CREATE TABLE fx_rates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base       char(3) NOT NULL REFERENCES currencies(code),
  quote      char(3) NOT NULL REFERENCES currencies(code),
  rate       numeric(24,12) NOT NULL CHECK (rate > 0),
  rate_date  date NOT NULL,
  source     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base, quote, rate_date)
);
CREATE INDEX fx_rates_lookup_idx ON fx_rates (base, quote, rate_date DESC);

CREATE TABLE data_sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_iso2  char(2) REFERENCES countries(iso2),
  code          text NOT NULL UNIQUE,
  name          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('api','csv_url','scrape','crowd','enumerator','manual')),
  url           text,
  licence       text,
  config        jsonb NOT NULL DEFAULT '{}',
  trust_weight  numeric(4,3) NOT NULL DEFAULT 1.0,
  active        boolean NOT NULL DEFAULT true
);

-- Ancestor of a region at a given admin level (self if already at that level).
CREATE OR REPLACE FUNCTION region_ancestor_at_level(rid uuid, lvl int) RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH RECURSIVE up AS (
    SELECT id, parent_id, level FROM regions WHERE id = rid
    UNION ALL
    SELECT r.id, r.parent_id, r.level FROM regions r JOIN up ON r.id = up.parent_id
  )
  SELECT id FROM up WHERE level = lvl LIMIT 1
$$;
