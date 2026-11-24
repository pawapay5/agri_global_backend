import { Body, Controller, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";
import Decimal from "decimal.js";
import { Public } from "../../common/auth/auth.common";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { I18nService } from "../../common/i18n/i18n.service";
import { Display, DisplayHints } from "../../common/money/money.service";
import { Cache } from "../../common/redis/redis.module";
import { upperIso } from "../geo/geo.dto";
import { MediaService } from "../uploads/media.service";
import { computePlan, pickRule, PlanLine, Product, toHectares } from "./fertiliser.logic";

type L = Record<string, string>;
const bool = ({ value }: { value: unknown }) => (value === "true" ? true : value === "false" ? false : value);

class CountryReq { @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country: string }
class GuidesQ extends CountryReq { @IsOptional() @IsUUID() commodity_id?: string }
class PestsQ {
  @IsOptional() @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country?: string;
  @IsOptional() @IsUUID() commodity_id?: string;
  @IsOptional() @IsIn(["pest", "disease", "weed", "deficiency"]) kind?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}
class FertDto {
  @Matches(/^[A-Z]{2}$/) country: string;
  @IsUUID() commodityId: string;
  @IsNumber() @Min(0.0001) @Max(100000) area: number;
  @IsString() @MaxLength(16) areaUnit: string;
  @IsOptional() @IsUUID() regionId?: string;
  @IsOptional() @IsIn(["subsistence", "commercial", "mixed", "organic", "irrigated", "rainfed"]) farmingType?: string;
}
class ProgrammesQ extends CountryReq { @IsOptional() @Transform(bool) @IsBoolean() open?: boolean; @IsOptional() @IsUUID() commodity_id?: string }
class TrainingQ {
  @IsOptional() @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country?: string;
  @IsOptional() @IsIn(["article", "event", "video", "course"]) kind?: string;
  @IsOptional() @Transform(bool) @IsBoolean() upcoming?: boolean;
}
class SuppliersQ extends CountryReq {
  @IsOptional() @IsUUID() region_id?: string;
  @IsOptional() @IsIn(["seed", "fertiliser", "agrochemical", "equipment", "feed", "veterinary", "irrigation", "packaging"]) category?: string;
  @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit: number = 20;
}

@Injectable()
export class KnowledgeService {
  constructor(private readonly sql: Sql, private readonly i18n: I18nService, private readonly media: MediaService, private readonly cache: Cache) {}

  async guides(q: GuidesQ, locale: string) {
    const rows = await this.sql.many<{ id: string; commodity_id: string; title: L; summary: L; version: number; reviewed_at: Date | null; updated_at: Date }>(
      `SELECT id, commodity_id, title, summary, version, reviewed_at, updated_at FROM crop_guides WHERE country_iso2 = $1 AND status = 'published' AND ($2::uuid IS NULL OR commodity_id = $2) ORDER BY updated_at DESC`,
      [q.country, q.commodity_id ?? null]);
    return rows.map((g) => ({ id: g.id, commodityId: g.commodity_id, title: this.i18n.pick(g.title, locale), summary: this.i18n.pick(g.summary, locale), sections: [],
      version: g.version, reviewedAt: g.reviewed_at?.toISOString() ?? null, updatedAt: g.updated_at.toISOString() }));
  }

  async guide(id: string, locale: string) {
    const g = await this.sql.one<{ id: string; commodity_id: string; title: L; summary: L; sections: { key: string; title: L; body: L }[]; version: number; reviewed_at: Date | null; updated_at: Date }>(
      `SELECT * FROM crop_guides WHERE id = $1 AND status = 'published'`, [id]);
    if (!g) throw AppError.notFound("crop_guide");
    return { id: g.id, commodityId: g.commodity_id, title: this.i18n.pick(g.title, locale), summary: this.i18n.pick(g.summary, locale),
      sections: g.sections.map((s) => ({ key: s.key, title: this.i18n.pick(s.title, locale), body: this.i18n.pick(s.body, locale) })),
      version: g.version, reviewedAt: g.reviewed_at?.toISOString() ?? null, updatedAt: g.updated_at.toISOString() };
  }

  private pestDto(p: Record<string, any>, locale: string, full: boolean) {
    return {
      id: p.id, kind: p.kind, name: this.i18n.pick(p.name, locale), scientificName: p.scientific_name, commodityIds: p.commodity_ids,
      symptoms: this.i18n.pick(p.symptoms, locale),
      photos: (p.photos as { variants: Record<string, string>; caption?: L; credit?: string }[]).slice(0, full ? 20 : 1)
        .map((ph) => ({ urls: this.media.urls(ph.variants ?? {}), caption: this.i18n.pick(ph.caption, locale), credit: ph.credit ?? "" })),
      ...(full ? {
        organicControl: this.i18n.pick(p.organic_control, locale), chemicalControl: this.i18n.pick(p.chemical_control, locale), prevention: this.i18n.pick(p.prevention, locale),
        safetyNote: this.i18n.t("knowledge.chemical_safety", locale),
      } : {}),
      version: p.version, reviewedAt: p.reviewed_at?.toISOString() ?? null,
    };
  }

  async pests(q: PestsQ, locale: string) {
    const rows = await this.sql.many(
      `SELECT * FROM pest_diseases WHERE status = 'published' AND (country_iso2 IS NULL OR $1::char(2) IS NULL OR country_iso2 = $1)
         AND ($2::uuid IS NULL OR $2 = ANY(commodity_ids)) AND ($3::text IS NULL OR kind = $3)
         AND ($4::text IS NULL OR search @@ plainto_tsquery('simple', immutable_unaccent($4)) OR jsonb_text_values(name) ILIKE '%' || $4 || '%')
       ORDER BY jsonb_text_values(name) LIMIT 200`, [q.country ?? null, q.commodity_id ?? null, q.kind ?? null, q.q ?? null]);
    return rows.map((p) => this.pestDto(p, locale, false));
  }

  async pest(id: string, locale: string) {
    const p = await this.sql.one(`SELECT * FROM pest_diseases WHERE id = $1 AND status = 'published'`, [id]);
    if (!p) throw AppError.notFound("pest");
    return this.pestDto(p, locale, true);
  }

  /** Only published, agronomist-reviewed rules are ever used (also enforced by a DB CHECK). */
  async fertiliser(d: FertDto, locale: string) {
    const country = await this.sql.one<{ config: { area_units?: Record<string, string> } }>(`SELECT config FROM countries WHERE iso2 = $1`, [d.country]);
    if (!country) throw AppError.notFound("country");
    let ha: Decimal;
    try { ha = toHectares(d.area, d.areaUnit, country.config.area_units ?? {}); }
    catch (e) { throw AppError.unprocessable("area_unit_invalid", (e as Error).message); }
    if (ha.gt(10_000)) throw AppError.unprocessable("area_too_large", "Use the calculator per field (max 10,000 ha)");
    const regionIds = d.regionId ? (await this.sql.many<{ id: string }>(
      `WITH RECURSIVE up AS (SELECT id, parent_id FROM regions WHERE id = $1 UNION ALL SELECT r.id, r.parent_id FROM regions r JOIN up ON r.id = up.parent_id) SELECT id FROM up`, [d.regionId])).map((r) => r.id) : [];
    const rules = await this.sql.many<{ id: string; region_id: string | null; farming_type: string | null; applications: any[]; notes: L; source: string; version: number; reviewed_at: Date }>(
      `SELECT * FROM fertiliser_rules WHERE country_iso2 = $1 AND commodity_id = $2 AND status = 'published' AND reviewed_at IS NOT NULL`, [d.country, d.commodityId]);
    const rule = pickRule(rules, regionIds, d.farmingType);
    if (!rule) throw AppError.notFound("fertiliser_rule", "No reviewed recommendation for this crop yet. Ask your extension officer.");
    const products = new Map<string, Product>((await this.sql.many<{ code: string; name: L; bag_kg: string; n_pct: string; p2o5_pct: string; k2o_pct: string }>(
      `SELECT code, name, bag_kg::text, n_pct::text, p2o5_pct::text, k2o_pct::text FROM fertiliser_products WHERE country_iso2 = $1`, [d.country]))
      .map((p) => [p.code, { code: p.code, name: p.name, bagKg: p.bag_kg, n: p.n_pct, p2o5: p.p2o5_pct, k2o: p.k2o_pct }]));
    let lines: PlanLine[];
    try { lines = computePlan(rule.applications, products, ha); }
    catch (e) { throw new AppError(500, "rule_misconfigured", "Internal server error", (e as Error).message); }
    const sum = (f: (l: (typeof lines)[number]) => string) => lines.reduce((s, l) => s.plus(f(l)), new Decimal(0)).toFixed(1);
    return {
      ruleId: rule.id, ruleVersion: rule.version, hectares: ha.toDecimalPlaces(4).toFixed(4), source: rule.source, reviewedAt: rule.reviewed_at.toISOString(),
      applications: lines.map((l) => ({ ...l, product: this.i18n.pick(l.productName, locale), productName: undefined, timing: this.i18n.pick(l.timing, locale), method: l.method ? this.i18n.pick(l.method, locale) : null })),
      totals: { kg: sum((l) => l.kg), nKg: sum((l) => l.nutrientsKg.n), p2o5Kg: sum((l) => l.nutrientsKg.p2o5), k2oKg: sum((l) => l.nutrientsKg.k2o) },
      notes: this.i18n.pick(rule.notes, locale), safetyNote: this.i18n.t("knowledge.fertiliser_safety", locale),
    };
  }

  async programmes(q: ProgrammesQ, locale: string) {
    const rows = await this.sql.many<{ id: string; kind: string; title: L; body: L; agency: string | null; eligibility: L; opens_at: Date | null; closes_at: Date | null; url: string | null; open: boolean }>(
      `SELECT *, (coalesce(opens_at, '-infinity') <= current_date AND coalesce(closes_at, 'infinity') >= current_date) AS open FROM programmes
       WHERE country_iso2 = $1 AND status = 'published' AND ($2::uuid IS NULL OR cardinality(commodity_ids) = 0 OR $2 = ANY(commodity_ids))
       ORDER BY closes_at NULLS LAST`, [q.country, q.commodity_id ?? null]);
    return rows.filter((p) => q.open === undefined || p.open === q.open).map((p) => ({
      id: p.id, kind: p.kind, title: this.i18n.pick(p.title, locale), body: this.i18n.pick(p.body, locale), agency: p.agency, eligibility: this.i18n.pick(p.eligibility, locale),
      opensAt: p.opens_at?.toISOString().slice(0, 10) ?? null, closesAt: p.closes_at?.toISOString().slice(0, 10) ?? null, open: p.open, url: p.url,
    }));
  }

  async training(q: TrainingQ, locale: string) {
    const rows = await this.sql.many<{ id: string; kind: string; title: L; body: L; starts_at: Date | null; ends_at: Date | null; venue: string | null; region_id: string | null; url: string | null }>(
      `SELECT * FROM training_items WHERE status = 'published' AND ($1::char(2) IS NULL OR country_iso2 IS NULL OR country_iso2 = $1) AND ($2::text IS NULL OR kind = $2)
         AND (NOT coalesce($3, false) OR coalesce(ends_at, starts_at) >= now())
       ORDER BY CASE WHEN kind = 'event' THEN starts_at END ASC NULLS LAST, updated_at DESC LIMIT 100`, [q.country ?? null, q.kind ?? null, q.upcoming ?? null]);
    return rows.map((t) => ({ id: t.id, kind: t.kind, title: this.i18n.pick(t.title, locale), body: this.i18n.pick(t.body, locale), startsAt: t.starts_at?.toISOString() ?? null,
      endsAt: t.ends_at?.toISOString() ?? null, venue: t.venue, regionId: t.region_id, url: t.url }));
  }

  async suppliers(q: SuppliersQ, locale: string) {
    const rows = await this.sql.many<{ id: string; name: string; categories: string[]; description: L; region_id: string | null; lat: number | null; lng: number | null; dist: number | null;
      phone: string | null; whatsapp: string | null; website: string | null; verified: boolean; user_id: string | null }>(
      `SELECT s.*, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
              CASE WHEN $4::float8 IS NULL OR location IS NULL THEN NULL ELSE ST_Distance(location, ST_SetSRID(ST_MakePoint($5,$4),4326)::geography) / 1000 END AS dist
       FROM input_suppliers s WHERE country_iso2 = $1 AND status = 'published'
         AND ($2::uuid IS NULL OR region_id = $2 OR region_ancestor_at_level(region_id, 1) = $2) AND ($3::text IS NULL OR $3 = ANY(categories))
       ORDER BY dist NULLS LAST, verified DESC, name LIMIT $6`, [q.country, q.region_id ?? null, q.category ?? null, q.lat ?? null, q.lng ?? null, q.limit]);
    return rows.map((s) => ({ id: s.id, name: s.name, categories: s.categories, description: this.i18n.pick(s.description, locale), regionId: s.region_id,
      location: s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null, distanceKm: s.dist != null ? Math.round(s.dist * 10) / 10 : null,
      phone: s.phone, whatsapp: s.whatsapp, website: s.website, verified: s.verified, sellerId: s.user_id }));
  }
}

@ApiTags("knowledge")
@Public()
@Controller("v1/knowledge")
export class KnowledgeController {
  constructor(private readonly k: KnowledgeService) {}
  private l(d: DisplayHints) { return d.locale ?? "en"; }

  @Get("crop-guides") @ApiOperation({ operationId: "knowledge_crop_guides_list" })
  guides(@Query() q: GuidesQ, @Display() d: DisplayHints) { return this.k.guides(q, this.l(d)); }

  @Get("crop-guides/:id") @ApiOperation({ operationId: "knowledge_crop_guides_get" })
  guide(@Param("id", ParseUUIDPipe) id: string, @Display() d: DisplayHints) { return this.k.guide(id, this.l(d)); }

  @Get("pests") @ApiOperation({ operationId: "knowledge_pests_list" })
  pests(@Query() q: PestsQ, @Display() d: DisplayHints) { return this.k.pests(q, this.l(d)); }

  @Get("pests/:id") @ApiOperation({ operationId: "knowledge_pests_get" })
  pest(@Param("id", ParseUUIDPipe) id: string, @Display() d: DisplayHints) { return this.k.pest(id, this.l(d)); }

  @Post("fertiliser/calculate") @HttpCode(200) @ApiOperation({ operationId: "knowledge_fertiliser_calculate" })
  fert(@Body() b: FertDto, @Display() d: DisplayHints) { return this.k.fertiliser(b, this.l(d)); }

  @Get("programmes") @ApiOperation({ operationId: "knowledge_programmes_list" })
  programmes(@Query() q: ProgrammesQ, @Display() d: DisplayHints) { return this.k.programmes(q, this.l(d)); }

  @Get("training") @ApiOperation({ operationId: "knowledge_training_list" })
  training(@Query() q: TrainingQ, @Display() d: DisplayHints) { return this.k.training(q, this.l(d)); }

  @Get("suppliers") @ApiOperation({ operationId: "knowledge_suppliers_list" })
  suppliers(@Query() q: SuppliersQ, @Display() d: DisplayHints) { return this.k.suppliers(q, this.l(d)); }
}

@Module({ controllers: [KnowledgeController], providers: [KnowledgeService] })
export class KnowledgeModule {}
