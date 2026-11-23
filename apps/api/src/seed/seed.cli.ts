/**
 * Loads country packs into the database. Idempotent (upserts on natural keys).
 *   node dist/seed/seed.cli.js gh [more iso2...]
 * Seeds reference data, geography, catalogue, sources, advice rules and templates.
 * Never seeds prices or FX rates: those come from real sources via pipelines/.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { parse } from "yaml";

const ROOT = join(__dirname, "..", "..", "..", "..", "country-packs");
const load = <T>(...p: string[]): T => parse(readFileSync(join(ROOT, ...p), "utf8")) as T;
const opt = <T>(...p: string[]): T | null => (existsSync(join(ROOT, ...p)) ? load<T>(...p) : null);

type L = Record<string, string>;
interface Reference {
  currencies: { code: string; name: string; minor_units: number }[];
  units: { code: string; kind: string; kg_factor?: number; name: L }[];
  categories: { code: string; sort_order: number; icon?: string; name: L }[];
  commodities: { code: string; category: string; hs_code?: string; perishability: string; shelf_life_days?: number; default_unit: string; name: L }[];
  export_requirements: { destination: string; code: string; mandatory: boolean; authority?: string; url?: string; title: L; description?: L; commodity?: string; category?: string }[];
}

async function seedReference(db: Client) {
  const ref = load<Reference>("_global", "reference.yaml");
  for (const c of ref.currencies)
    await db.query(`INSERT INTO currencies (code, name, minor_units) VALUES ($1,$2,$3) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, minor_units = EXCLUDED.minor_units`, [c.code, c.name, c.minor_units]);
  for (const u of ref.units)
    await db.query(`INSERT INTO units (code, name, kind, kg_factor) VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, kg_factor = EXCLUDED.kg_factor`, [u.code, u.name, u.kind, u.kg_factor ?? null]);
  for (const c of ref.categories)
    await db.query(`INSERT INTO commodity_categories (code, name, icon, sort_order) VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon, sort_order = EXCLUDED.sort_order`, [c.code, c.name, c.icon ?? null, c.sort_order]);
  for (const c of ref.commodities)
    await db.query(
      `INSERT INTO commodities (code, category_id, name, hs_code, perishability, shelf_life_days, default_unit)
       VALUES ($1, (SELECT id FROM commodity_categories WHERE code = $2), $3, $4, $5, $6, $7)
       ON CONFLICT (code) DO UPDATE SET category_id = EXCLUDED.category_id, name = EXCLUDED.name, hs_code = EXCLUDED.hs_code,
         perishability = EXCLUDED.perishability, shelf_life_days = EXCLUDED.shelf_life_days, default_unit = EXCLUDED.default_unit`,
      [c.code, c.category, c.name, c.hs_code ?? null, c.perishability, c.shelf_life_days ?? null, c.default_unit]);
  // Export requirements have no natural unique key: replace the set wholesale.
  await db.query(`DELETE FROM export_requirements`);
  for (const [i, r] of ref.export_requirements.entries())
    await db.query(
      `INSERT INTO export_requirements (destination, commodity_id, category_id, code, title, description, mandatory, authority, url, sort_order)
       VALUES ($1, (SELECT id FROM commodities WHERE code = $2), (SELECT id FROM commodity_categories WHERE code = $3), $4, $5, $6, $7, $8, $9, $10)`,
      [r.destination, r.commodity ?? null, r.category ?? null, r.code, r.title, r.description ?? {}, r.mandatory, r.authority ?? null, r.url ?? null, i]);
  console.log(`  reference: ${ref.currencies.length} currencies, ${ref.units.length} units, ${ref.commodities.length} commodities`);
}

async function seedCountry(db: Client, iso: string) {
  const dir = iso.toLowerCase();
  const c = load<{ iso2: string; iso3: string; brand_name?: string; name: L; currency: string; default_locale: string; locales: string[]; default_unit: string; area_unit: string; timezone: string; phone_prefix?: string; bbox?: number[]; region_levels: unknown[]; active: boolean; config?: unknown }>(dir, "country.yaml");
  await db.query(
    `INSERT INTO countries (iso2, iso3, name, brand_name, currency, default_locale, locales, default_unit, area_unit, timezone, phone_prefix, region_levels, bbox, config, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (iso2) DO UPDATE SET iso3 = EXCLUDED.iso3, name = EXCLUDED.name, brand_name = EXCLUDED.brand_name, currency = EXCLUDED.currency,
       default_locale = EXCLUDED.default_locale, locales = EXCLUDED.locales, default_unit = EXCLUDED.default_unit, area_unit = EXCLUDED.area_unit,
       timezone = EXCLUDED.timezone, phone_prefix = EXCLUDED.phone_prefix, region_levels = EXCLUDED.region_levels, bbox = EXCLUDED.bbox,
       config = EXCLUDED.config, active = EXCLUDED.active`,
    [c.iso2, c.iso3, c.name, c.brand_name ?? null, c.currency, c.default_locale, c.locales, c.default_unit, c.area_unit, c.timezone, c.phone_prefix ?? null,
      JSON.stringify(c.region_levels), c.bbox ?? null, c.config ?? {}, c.active]);

  // Regions: parents first (sorted by level).
  const regions = load<{ code: string; iso?: string; level: number; parent?: string; name: L; centroid?: [number, number] }[]>(dir, "regions.yaml").sort((a, b) => a.level - b.level);
  for (const r of regions)
    await db.query(
      `INSERT INTO regions (country_iso2, parent_id, code, name, level, centroid)
       VALUES ($1, (SELECT id FROM regions WHERE country_iso2 = $1 AND code = $2), $3, $4, $5,
               CASE WHEN $6::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography END)
       ON CONFLICT (country_iso2, code) DO UPDATE SET parent_id = EXCLUDED.parent_id, name = EXCLUDED.name, level = EXCLUDED.level,
         centroid = coalesce(EXCLUDED.centroid, regions.centroid)`,
      [c.iso2, r.parent ?? null, r.code, r.name, r.level, r.centroid?.[0] ?? null, r.centroid?.[1] ?? null]);

  // Optional polygons (e.g. geoBoundaries ADM1 GeoJSON).
  const gj = opt<{ features: { properties: Record<string, string>; geometry: unknown }[] }>(dir, "regions.geojson");
  if (gj) {
    let matched = 0;
    for (const f of gj.features) {
      const key = f.properties.shapeISO ?? f.properties.code;
      const r = regions.find((x) => x.iso === key || x.code === key);
      if (!r) continue;
      await db.query(
        `UPDATE regions SET geom = ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))),
           centroid = ST_PointOnSurface(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))::geography
         WHERE country_iso2 = $1 AND code = $2`, [c.iso2, r.code, JSON.stringify(f.geometry)]);
      matched++;
    }
    console.log(`  polygons: ${matched}/${regions.length} regions`);
  }

  const markets = load<{ code: string; region: string; type: string; location: [number, number]; operating_days: number[]; name: L; aliases?: string[] }[]>(dir, "markets.yaml");
  for (const m of markets)
    await db.query(
      `INSERT INTO markets (country_iso2, region_id, code, name, type, location, operating_days, aliases)
       VALUES ($1, (SELECT id FROM regions WHERE country_iso2 = $1 AND code = $2), $3, $4, $5, ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography, $8, $9)
       ON CONFLICT (country_iso2, code) DO UPDATE SET region_id = EXCLUDED.region_id, name = EXCLUDED.name, type = EXCLUDED.type,
         location = EXCLUDED.location, operating_days = EXCLUDED.operating_days, aliases = EXCLUDED.aliases`,
      [c.iso2, m.region, m.code, m.name, m.type, m.location[0], m.location[1], m.operating_days, m.aliases ?? []]);

  type Tracked = { code: string; local_names?: L; major_regions?: string[]; aliases?: string[]; units?: Record<string, number>; calendars?: { regions?: string[]; planting: number[]; harvest: number[]; lean?: number[] }[] };
  const { tracked } = load<{ tracked: Tracked[] }>(dir, "commodities.yaml");
  for (const t of tracked) {
    const cid = (await db.query<{ id: string }>(`SELECT id FROM commodities WHERE code = $1`, [t.code])).rows[0]?.id;
    if (!cid) throw new Error(`${iso}: unknown commodity code ${t.code} (add it to _global/reference.yaml)`);
    await db.query(
      `INSERT INTO commodity_country_profiles (commodity_id, country_iso2, local_names, major_region_ids, aliases, tracked)
       VALUES ($1, $2, $3, (SELECT coalesce(array_agg(id), '{}') FROM regions WHERE country_iso2 = $2 AND code = ANY($4::text[])), $5, true)
       ON CONFLICT (commodity_id, country_iso2) DO UPDATE SET local_names = EXCLUDED.local_names, major_region_ids = EXCLUDED.major_region_ids,
         aliases = EXCLUDED.aliases, tracked = true`,
      [cid, c.iso2, t.local_names ?? {}, t.major_regions ?? [], t.aliases ?? []]);
    for (const [unit, kg] of Object.entries(t.units ?? {}))
      await db.query(
        `INSERT INTO commodity_unit_conversions (commodity_id, unit_code, country_iso2, kg_factor) VALUES ($1, $2, $3, $4)
         ON CONFLICT (commodity_id, unit_code, coalesce(country_iso2, '--')) DO UPDATE SET kg_factor = EXCLUDED.kg_factor`, [cid, unit, c.iso2, kg]);
    await db.query(`DELETE FROM crop_calendars WHERE commodity_id = $1 AND country_iso2 = $2`, [cid, c.iso2]);
    for (const cal of t.calendars ?? []) {
      const targets = cal.regions?.length ? cal.regions : [null];
      for (const rc of targets)
        await db.query(
          `INSERT INTO crop_calendars (commodity_id, country_iso2, region_id, planting_months, harvest_months, lean_months)
           VALUES ($1, $2, (SELECT id FROM regions WHERE country_iso2 = $2 AND code = $3), $4, $5, $6)`,
          [cid, c.iso2, rc, cal.planting, cal.harvest, cal.lean ?? []]);
    }
  }

  const sources = opt<{ code: string; name: string; kind: string; url?: string; licence?: string; trust_weight: number; config?: unknown }[]>(dir, "sources.yaml") ?? [];
  for (const s of sources)
    await db.query(
      `INSERT INTO data_sources (country_iso2, code, name, kind, url, licence, config, trust_weight) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, url = EXCLUDED.url, licence = EXCLUDED.licence,
         config = EXCLUDED.config, trust_weight = EXCLUDED.trust_weight`,
      [c.iso2, s.code, s.name, s.kind, s.url ?? null, s.licence ?? null, s.config ?? {}, s.trust_weight]);

  const advice = opt<{ code: string; severity: string; i18n_key: string; months?: number[]; commodity?: string; condition: unknown }[]>(dir, "advice.yaml") ?? [];
  for (const a of advice)
    await db.query(
      `INSERT INTO agro_advice_rules (country_iso2, commodity_id, code, severity, condition, months, i18n_key)
       VALUES ($1, (SELECT id FROM commodities WHERE code = $2), $3, $4, $5, $6, $7)
       ON CONFLICT (country_iso2, code) DO UPDATE SET commodity_id = EXCLUDED.commodity_id, severity = EXCLUDED.severity,
         condition = EXCLUDED.condition, months = EXCLUDED.months, i18n_key = EXCLUDED.i18n_key`,
      [c.iso2, a.commodity ?? null, a.code, a.severity, a.condition, a.months ?? [], a.i18n_key]);

  const templates = opt<{ key: string; channel: string; locale: string; subject?: string; body: string; provider_template?: string }[]>(dir, "templates.yaml") ?? [];
  for (const t of templates)
    await db.query(
      `INSERT INTO notification_templates (key, channel, locale, subject, body, provider_template) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (key, channel, locale) DO UPDATE SET subject = EXCLUDED.subject, body = EXCLUDED.body, provider_template = EXCLUDED.provider_template`,
      [t.key, t.channel, t.locale, t.subject ?? null, t.body, t.provider_template ?? null]);

  console.log(`  ${c.iso2}: ${regions.length} regions, ${markets.length} markets, ${tracked.length} commodities, ${sources.length} sources, ${advice.length} advice rules, ${templates.length} templates`);
}

async function main() {
  const countries = process.argv.slice(2);
  if (!countries.length) { console.error("usage: seed <iso2> [iso2...]"); process.exit(2); }
  const db = new Client({ connectionString: process.env.DATABASE_URL ?? "postgres://agriprice:agriprice@localhost:5432/agriprice" });
  await db.connect();
  try {
    await db.query("BEGIN");
    await seedReference(db);
    for (const iso of countries) await seedCountry(db, iso);
    await db.query("COMMIT");
    console.log("✓ seed complete");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    await db.end();
  }
}
void main().catch((e) => { console.error(e); process.exit(1); });
