import { Inject, Injectable, Logger } from "@nestjs/common";
import { APP_CONFIG, AppConfig } from "../../config/config";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { cursor } from "../../common/http/request-context";
import { Cache } from "../../common/redis/redis.module";
import { StorageService } from "../../common/storage/storage.service";
import { GeoRepository, MARKET_COLS, MarketRow } from "../geo/geo.repository";

interface CommodityRow {
  id: string; code: string; name: Record<string, string>; category_id: string; hs_code: string | null; perishability: string;
  shelf_life_days: number | null; default_unit: string; image_key: string | null;
}
const COMMODITY_COLS = `c.id, c.code, c.name, c.category_id, c.hs_code, c.perishability, c.shelf_life_days, c.default_unit, c.image_key`;

@Injectable()
export class CatalogueService {
  private readonly log = new Logger(CatalogueService.name);
  constructor(
    private readonly sql: Sql,
    private readonly cache: Cache,
    private readonly storage: StorageService,
    private readonly geo: GeoRepository,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  toCommodity(c: CommodityRow) {
    return {
      id: c.id, code: c.code, name: c.name, categoryId: c.category_id, hsCode: c.hs_code, perishability: c.perishability,
      shelfLifeDays: c.shelf_life_days, defaultUnit: c.default_unit, imageUrl: this.storage.publicUrl(this.cfg.s3.imagesBucket, c.image_key),
    };
  }

  categories() {
    return this.cache.wrap("cat:categories", 600, async () =>
      (await this.sql.many<{ id: string; code: string; name: Record<string, string>; icon: string | null; sort_order: number }>(
        `SELECT id, code, name, icon, sort_order FROM commodity_categories ORDER BY sort_order, code`,
      )).map((r) => ({ id: r.id, code: r.code, name: r.name, icon: r.icon, sortOrder: r.sort_order })));
  }

  async commodities(q: { country?: string; category_id?: string; q?: string; cursor?: string; limit: number }) {
    const c = cursor.decode<{ code: string }>(q.cursor);
    const rows = await this.sql.many<CommodityRow>(
      `SELECT ${COMMODITY_COLS} FROM commodities c
       WHERE c.active
         AND ($1::char(2) IS NULL OR EXISTS (SELECT 1 FROM commodity_country_profiles p WHERE p.commodity_id = c.id AND p.country_iso2 = $1 AND p.tracked))
         AND ($2::uuid IS NULL OR c.category_id = $2)
         AND ($3::text IS NULL OR c.search @@ plainto_tsquery('simple', immutable_unaccent($3))
              OR immutable_unaccent(jsonb_text_values(c.name)) ILIKE '%' || immutable_unaccent($3) || '%'
              OR EXISTS (SELECT 1 FROM commodity_country_profiles p WHERE p.commodity_id = c.id AND immutable_unaccent(jsonb_text_values(p.local_names)) ILIKE '%' || immutable_unaccent($3) || '%'))
         AND ($4::text IS NULL OR c.code > $4)
       ORDER BY c.code LIMIT $5`, [q.country ?? null, q.category_id ?? null, q.q ?? null, c?.code ?? null, q.limit + 1]);
    const page = rows.slice(0, q.limit);
    return { data: page.map((r) => this.toCommodity(r)), nextCursor: rows.length > q.limit ? cursor.encode({ code: page[page.length - 1]!.code }) : null };
  }

  async commodity(id: string, country?: string) {
    const c = await this.sql.one<CommodityRow>(`SELECT ${COMMODITY_COLS} FROM commodities c WHERE c.id = $1`, [id]);
    if (!c) throw AppError.notFound("commodity");
    let countryProfile: unknown = null;
    if (country) {
      const p = await this.sql.one<{ local_names: Record<string, string>; major_region_ids: string[] }>(
        `SELECT local_names, major_region_ids FROM commodity_country_profiles WHERE commodity_id = $1 AND country_iso2 = $2`, [id, country]);
      const seasons = await this.sql.many<{ region_id: string | null; planting_months: number[]; harvest_months: number[]; lean_months: number[] }>(
        `SELECT region_id, planting_months, harvest_months, lean_months FROM crop_calendars WHERE commodity_id = $1 AND country_iso2 = $2`, [id, country]);
      if (p || seasons.length) {
        countryProfile = {
          country, localNames: p?.local_names ?? {},
          seasons: seasons.map((s) => ({ regionId: s.region_id, plantingMonths: s.planting_months, harvestMonths: s.harvest_months, leanMonths: s.lean_months })),
          majorProducingRegionIds: p?.major_region_ids ?? [],
        };
      }
    }
    return { ...this.toCommodity(c), countryProfile, varieties: await this.varieties(id) };
  }

  async varieties(commodityId: string) {
    return (await this.sql.many<{ id: string; commodity_id: string; code: string; name: Record<string, string> }>(
      `SELECT id, commodity_id, code, name FROM varieties WHERE commodity_id = $1 ORDER BY code`, [commodityId],
    )).map((v) => ({ id: v.id, commodityId: v.commodity_id, code: v.code, name: v.name }));
  }

  async units(q: { country?: string; commodity_id?: string }) {
    const rows = await this.sql.many<{ code: string; name: Record<string, string>; kind: string; kg_factor: string | null; commodity_id: string | null }>(
      `SELECT u.code, u.name, u.kind,
              coalesce(cs.kg_factor, cg.kg_factor, u.kg_factor) AS kg_factor,
              coalesce(cs.commodity_id, cg.commodity_id) AS commodity_id
       FROM units u
       LEFT JOIN commodity_unit_conversions cs ON $2::uuid IS NOT NULL AND cs.commodity_id = $2 AND cs.unit_code = u.code AND cs.country_iso2 = $1
       LEFT JOIN commodity_unit_conversions cg ON $2::uuid IS NOT NULL AND cg.commodity_id = $2 AND cg.unit_code = u.code AND cg.country_iso2 IS NULL
       WHERE $2::uuid IS NULL OR u.kg_factor IS NOT NULL OR cs.kg_factor IS NOT NULL OR cg.kg_factor IS NOT NULL
       ORDER BY u.kind, u.code`, [q.country ?? null, q.commodity_id ?? null]);
    return rows.map((r) => ({ code: r.code, name: r.name, kind: r.kind, kgFactor: r.kg_factor, commodityId: r.commodity_id }));
  }

  async search(q: string, country: string | undefined, limit: number) {
    if (this.cfg.search.provider === "meilisearch" && this.cfg.search.meiliUrl) {
      try { return await this.meili(q, country, limit); } catch (e) { this.log.warn({ err: (e as Error).message }, "meilisearch unavailable, using postgres"); }
    }
    const [commodities, markets] = await Promise.all([
      this.commodities({ q, country, limit }).then((r) => r.data),
      this.sql.many<MarketRow>(
        `SELECT ${MARKET_COLS}, similarity(immutable_unaccent(jsonb_text_values(m.name)), immutable_unaccent($1)) AS sim
         FROM markets m LEFT JOIN regions r ON r.id = m.region_id
         WHERE m.active AND ($2::char(2) IS NULL OR m.country_iso2 = $2)
           AND (m.search @@ plainto_tsquery('simple', immutable_unaccent($1)) OR immutable_unaccent(jsonb_text_values(m.name)) % immutable_unaccent($1)
                OR immutable_unaccent(jsonb_text_values(m.name)) ILIKE '%' || immutable_unaccent($1) || '%')
         ORDER BY sim DESC LIMIT $3`, [q, country ?? null, limit]),
    ]);
    return { provider: "postgres" as const, commodities, markets: markets.map((m) => this.geo.toMarket(m)) };
  }

  /** Indexes are maintained by workers (search-sync job). Documents mirror the API shapes. */
  private async meili(q: string, country: string | undefined, limit: number) {
    const body = (index: string) => ({ indexUid: index, q, limit, filter: country ? [`country = ${JSON.stringify(country)}`] : undefined });
    const res = await fetch(`${this.cfg.search.meiliUrl}/multi-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.cfg.search.meiliKey}` },
      body: JSON.stringify({ queries: [body("commodities"), body("markets")] }),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) throw new Error(`meili ${res.status}`);
    const json = (await res.json()) as { results: { hits: Record<string, unknown>[] }[] };
    return { provider: "meilisearch" as const, commodities: json.results[0]?.hits ?? [], markets: json.results[1]?.hits ?? [] };
  }
}
