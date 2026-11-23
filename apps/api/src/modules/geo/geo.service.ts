import { Injectable } from "@nestjs/common";
import type { AuthUser } from "../../common/auth/auth.common";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { cursor } from "../../common/http/request-context";
import { DisplayHints, MoneyService } from "../../common/money/money.service";
import { Cache } from "../../common/redis/redis.module";
import type { ChoroplethQuery, MarketsGeoJsonQuery, MarketsQuery, NearbyQuery, RegionsGeoJsonQuery, RegionsQuery } from "./geo.dto";
import { GeoRepository, MARKET_COLS, MarketRow } from "./geo.repository";

interface CountryRow {
  iso2: string; iso3: string; name: Record<string, string>; brand_name: string | null; currency: string; default_locale: string; locales: string[];
  default_unit: string; area_unit: string; timezone: string; phone_prefix: string | null; region_levels: unknown[]; bbox: number[] | null; active: boolean;
}

@Injectable()
export class GeoService {
  constructor(private readonly sql: Sql, private readonly repo: GeoRepository, private readonly money: MoneyService, private readonly cache: Cache) {}

  private toCountry(c: CountryRow) {
    return {
      iso2: c.iso2, iso3: c.iso3, name: c.name, brandName: c.brand_name ?? undefined, currency: c.currency, defaultLocale: c.default_locale,
      locales: c.locales, defaultUnit: c.default_unit, areaUnit: c.area_unit, timezone: c.timezone, phonePrefix: c.phone_prefix ?? undefined,
      regionLevels: c.region_levels, bbox: c.bbox ?? undefined, active: c.active,
    };
  }

  async countries(active?: boolean) {
    const rows = await this.sql.many<CountryRow>(`SELECT * FROM countries WHERE ($1::boolean IS NULL OR active = $1) ORDER BY iso2`, [active ?? null]);
    return rows.map((c) => this.toCountry(c));
  }

  async country(iso2: string) {
    const c = await this.sql.one<CountryRow>(`SELECT * FROM countries WHERE iso2 = $1`, [iso2.toUpperCase()]);
    if (!c) throw AppError.notFound("country");
    return this.toCountry(c);
  }

  async regions(q: RegionsQuery) {
    const rows = await this.sql.many<{ id: string; country_iso2: string; parent_id: string | null; code: string; name: Record<string, string>; level: number; lat: number | null; lng: number | null }>(
      `SELECT id, country_iso2, parent_id, code, name, level, ST_Y(centroid::geometry) AS lat, ST_X(centroid::geometry) AS lng
       FROM regions WHERE country_iso2 = $1 AND ($2::uuid IS NULL OR parent_id = $2) AND ($3::int IS NULL OR level = $3)
       ORDER BY level, code`, [q.country, q.parent_id ?? null, q.level ?? null]);
    return rows.map((r) => ({
      id: r.id, country: r.country_iso2, parentId: r.parent_id, code: r.code, name: r.name, level: r.level,
      centroid: r.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : undefined,
    }));
  }

  /** Simplified polygons, cached. Geometry is the heavy part, so it's built in SQL. */
  async regionsGeoJson(q: RegionsGeoJsonQuery) {
    return this.cache.wrap(`geo:regions:${q.country}:${q.level}:${q.simplify}`, 3600, async () => {
      const r = await this.sql.one<{ fc: unknown }>(
        `SELECT json_build_object('type', 'FeatureCollection', 'features', coalesce(json_agg(json_build_object(
           'type', 'Feature', 'id', id,
           'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, $3), 5)::json,
           'properties', json_build_object('id', id, 'code', code, 'name', name, 'level', level)
         )), '[]'::json)) AS fc
         FROM regions WHERE country_iso2 = $1 AND level = $2 AND geom IS NOT NULL`, [q.country, q.level, q.simplify]);
      return r!.fc;
    });
  }

  async choropleth(q: ChoroplethQuery, hints: DisplayHints, user: AuthUser | null) {
    const ctx = await this.money.resolveDisplay(hints, user, q.country);
    const { factor, unit } = await this.money.factorFromLocal(q.commodity_id, ctx);
    const rows = await this.sql.many<{ region_id: string; code: string; name: Record<string, string>; avg: string | null; n: number; markets: number }>(
      `WITH agg AS (
         SELECT region_ancestor_at_level(d.region_id, $4) AS rid, sum(d.sum_kg_local) / nullif(sum(d.n), 0) AS avg, sum(d.n)::int AS n, count(DISTINCT d.market_id)::int AS markets
         FROM price_daily d
         WHERE d.country_iso2 = $1 AND d.commodity_id = $2 AND d.price_type = $3 AND d.bucket >= now() - make_interval(days => $5)
         GROUP BY 1
       )
       SELECT r.id AS region_id, r.code, r.name, a.avg, coalesce(a.n, 0) AS n, coalesce(a.markets, 0) AS markets
       FROM regions r LEFT JOIN agg a ON a.rid = r.id
       WHERE r.country_iso2 = $1 AND r.level = $4
       ORDER BY r.code`, [q.country, q.commodity_id, q.price_type, q.level, q.days]);
    const regions = rows.map((r) => ({ regionId: r.region_id, code: r.code, name: r.name, avg: this.money.apply(r.avg, factor), observations: r.n, marketCount: r.markets }));
    const vals = regions.map((r) => r.avg).filter((v): v is string => v != null).map(Number);
    return {
      commodityId: q.commodity_id, priceType: q.price_type, currency: ctx.currency, unit,
      min: vals.length ? Math.min(...vals).toFixed(2) : undefined, max: vals.length ? Math.max(...vals).toFixed(2) : undefined, regions,
    };
  }

  async markets(q: MarketsQuery) {
    const c = cursor.decode<{ code: string; id: string }>(q.cursor);
    const rows = await this.sql.many<MarketRow>(
      `SELECT ${MARKET_COLS} FROM markets m LEFT JOIN regions r ON r.id = m.region_id
       WHERE m.active
         AND ($1::char(2) IS NULL OR m.country_iso2 = $1)
         AND ($2::uuid IS NULL OR m.region_id = $2 OR m.region_id IN (SELECT id FROM regions WHERE parent_id = $2))
         AND ($3::text IS NULL OR m.type = $3)
         AND ($4::text IS NULL OR m.search @@ plainto_tsquery('simple', immutable_unaccent($4)) OR immutable_unaccent(jsonb_text_values(m.name)) ILIKE '%' || immutable_unaccent($4) || '%')
         AND ($5::text IS NULL OR (m.code, m.id) > ($5, $6::uuid))
       ORDER BY m.code, m.id LIMIT $7`,
      [q.country ?? null, q.region_id ?? null, q.type ?? null, q.q ?? null, c?.code ?? null, c?.id ?? null, q.limit + 1]);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return { data: page.map((m) => this.repo.toMarket(m)), nextCursor: rows.length > q.limit && last ? cursor.encode({ code: last.code, id: last.id }) : null };
  }

  async market(id: string) {
    const m = await this.repo.market(id);
    if (!m) throw AppError.notFound("market");
    return this.repo.toMarket(m);
  }

  async nearby(q: NearbyQuery, hints: DisplayHints, user: AuthUser | null) {
    const markets = await this.repo.marketsWithin(q.lat, q.lng, q.radius_km, q.limit);
    if (!markets.length) return [];
    const latest = new Map<string, Awaited<ReturnType<GeoService["latestFor"]>>[number]>();
    if (q.commodity_id) for (const p of await this.latestFor(q.commodity_id, q.price_type, markets.map((m) => m.id))) latest.set(p.market_id, p);
    const ctx = await this.money.resolveDisplay(hints, user, markets[0]!.country_iso2);
    return Promise.all(markets.map(async (m) => {
      const p = latest.get(m.id);
      return {
        ...this.repo.toMarket(m),
        distanceKm: Math.round(m.distance_km * 100) / 100,
        latestPrice: p ? { value: await this.money.priceValue(p, ctx), observedAt: p.observed_at.toISOString(), priceType: p.price_type } : null,
      };
    }));
  }

  /** Latest approved observation per market (index-backed LATERAL). */
  latestFor(commodityId: string, priceType: string, marketIds: string[]) {
    return this.sql.many<{ market_id: string; observed_at: Date; price_type: string; amount: string; currency: string; unit_code: string; price_per_kg_local: string; price_per_kg_usd: string; fx_rate_id: string | null; commodity_id: string }>(
      `SELECT mk.id AS market_id, o.observed_at, o.price_type, o.amount, o.currency, o.unit_code, o.price_per_kg_local, o.price_per_kg_usd, o.fx_rate_id, o.commodity_id
       FROM unnest($3::uuid[]) AS mk(id)
       CROSS JOIN LATERAL (
         SELECT * FROM price_observations p
         WHERE p.market_id = mk.id AND p.commodity_id = $1 AND p.price_type = $2 AND p.status = 'approved'
           AND p.observed_at > now() - interval '180 days'
         ORDER BY p.observed_at DESC LIMIT 1
       ) o`, [commodityId, priceType, marketIds]);
  }

  async marketsGeoJson(q: MarketsGeoJsonQuery) {
    const r = await this.sql.one<{ fc: unknown }>(
      `SELECT json_build_object('type', 'FeatureCollection', 'features', coalesce(json_agg(json_build_object(
         'type', 'Feature', 'id', m.id,
         'geometry', ST_AsGeoJSON(m.location::geometry, 6)::json,
         'properties', json_build_object('id', m.id, 'name', m.name, 'type', m.type, 'regionId', m.region_id,
            'latestPerKgLocal', lp.close_kg_local, 'latestAt', lp.last_observed_at)
       )), '[]'::json)) AS fc
       FROM markets m
       LEFT JOIN LATERAL (
         SELECT close_kg_local, last_observed_at FROM price_daily d
         WHERE $2::uuid IS NOT NULL AND d.market_id = m.id AND d.commodity_id = $2 AND d.price_type = $3
         ORDER BY d.bucket DESC LIMIT 1
       ) lp ON true
       WHERE m.country_iso2 = $1 AND m.active`, [q.country, q.commodity_id ?? null, q.price_type]);
    return r!.fc;
  }
}
