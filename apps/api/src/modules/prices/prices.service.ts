import { Injectable } from "@nestjs/common";
import type { AuthUser } from "../../common/auth/auth.common";
import { AuditService } from "../../common/audit/audit.service";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { cursor } from "../../common/http/request-context";
import type { ClientMeta } from "../../common/http/request-context";
import { D, fmt, pctChange } from "../../common/money/money.math";
import { DisplayContext, DisplayHints, MoneyService } from "../../common/money/money.service";
import { QueueService } from "../../common/queue/queues";
import { Cache } from "../../common/redis/redis.module";
import { GeoRepository } from "../geo/geo.repository";
import { GeoService } from "../geo/geo.service";
import { PriceIngestService } from "./ingest.service";
import { RANGE_DAYS, seriesStats } from "./price.logic";

/** Converts (perKgLocal, perKgUsd) → display. Same-currency uses local; otherwise historical USD × today's USD→target. */
export interface SeriesConverter { unit: string; currency: string; conv(local: string | number | null, usd?: string | number | null): string | null }

const OBS_COLS = `o.id, o.observed_at, o.commodity_id, o.variety_id, o.market_id, o.price_type, o.amount, o.currency, o.unit_code,
  o.price_per_kg_local, o.price_per_kg_usd, o.fx_rate_id, o.status, o.source, o.outlier_score, o.flags`;
type ObsRow = {
  id: string; observed_at: Date; commodity_id: string; variety_id: string | null; market_id: string; price_type: string; amount: string; currency: string;
  unit_code: string; price_per_kg_local: string; price_per_kg_usd: string; fx_rate_id: string | null; status: string; source: string; outlier_score: number | null; flags: string[];
};

@Injectable()
export class PricesService {
  constructor(
    private readonly sql: Sql,
    private readonly money: MoneyService,
    private readonly ingest: PriceIngestService,
    private readonly geo: GeoService,
    private readonly geoRepo: GeoRepository,
    private readonly cache: Cache,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  async converter(commodityId: string, ctx: DisplayContext): Promise<SeriesConverter> {
    const unit = await this.money.kgPerUnit(commodityId, ctx.unit, ctx.country).then(() => ctx.unit).catch(() => "kg");
    const kg = D(await this.money.kgPerUnit(commodityId, unit, ctx.country).catch(() => "1"));
    if (ctx.currency === ctx.localCurrency) return { unit, currency: ctx.currency, conv: (l) => (l == null ? null : fmt(D(l).mul(kg))) };
    const usdTo = await this.money.usdTo(ctx.currency);
    if (usdTo == null) throw AppError.unprocessable("currency_unsupported", `No FX rate for ${ctx.currency}`);
    const fallback = await this.money.rate(ctx.localCurrency, "USD");
    return {
      unit, currency: ctx.currency,
      conv: (l, u) => {
        if (u != null) return fmt(D(u).mul(usdTo).mul(kg));
        if (l == null || !fallback) return null;
        return fmt(D(l).mul(fallback.rate).mul(usdTo).mul(kg));
      },
    };
  }

  async toObservation(r: ObsRow, ctx: DisplayContext) {
    return {
      id: r.id, commodityId: r.commodity_id, varietyId: r.variety_id, marketId: r.market_id, priceType: r.price_type,
      value: await this.money.priceValue(r, ctx), observedAt: r.observed_at.toISOString(), status: r.status, source: r.source,
      outlierScore: r.outlier_score, flags: r.flags,
    };
  }

  // ── write ──
  async submit(dto: { commodityId: string; varietyId?: string; marketId: string; priceType: string; amount: string; currency: string; unit: string; quality?: string; observedAt: string; location?: { lat: number; lng: number }; note?: string },
    user: AuthUser, idempotencyKey: string | undefined, hints: DisplayHints, client: ClientMeta) {
    // Enumerators are trusted field staff; everyone else is crowd.
    const source = user.role === "enumerator" ? "enumerator" : "crowd";
    const daily = await this.sql.one<{ n: number }>(`SELECT count(*)::int AS n FROM price_observations WHERE submitted_by = $1 AND created_at > now() - interval '1 day'`, [user.id]);
    if (source === "crowd" && (daily?.n ?? 0) >= 100) throw AppError.tooMany("submission_limit", "Daily submission limit reached");

    const res = await this.ingest.ingest({
      commodityId: dto.commodityId, varietyId: dto.varietyId, marketId: dto.marketId, priceType: dto.priceType, amount: dto.amount, currency: dto.currency,
      unit: dto.unit, quality: dto.quality, observedAt: new Date(dto.observedAt), source, submittedBy: user.id, lat: dto.location?.lat, lng: dto.location?.lng,
      note: dto.note, idempotencyKey: idempotencyKey ?? null,
    });
    if (!res.duplicate) await this.audit.record({ actorId: user.id, action: "price.submitted", entity: "price_observation", entityId: res.id, data: { status: res.status } }, client);
    const row = await this.sql.one<ObsRow>(`SELECT ${OBS_COLS} FROM price_observations o WHERE o.id = $1`, [res.id]);
    const ctx = await this.money.resolveDisplay(hints, user);
    return this.toObservation(row!, ctx);
  }

  async reviewQueue(q: { country?: string; status: string; cursor?: string; limit: number }, user: AuthUser, hints: DisplayHints) {
    const country = user.role === "admin" ? q.country ?? null : user.country; // org_admin/enumerator scoped to own country
    const c = cursor.decode<{ t: string; id: string }>(q.cursor);
    const rows = await this.sql.many<ObsRow & { submitted_by: string | null; commodity_name: Record<string, string>; market_name: Record<string, string>; median: string | null }>(
      `SELECT ${OBS_COLS}, o.submitted_by, c.name AS commodity_name, m.name AS market_name,
         (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY p.price_per_kg_local) FROM price_observations p
          WHERE p.commodity_id = o.commodity_id AND p.price_type = o.price_type AND p.country_iso2 = o.country_iso2 AND p.status = 'approved'
            AND p.observed_at BETWEEN o.observed_at - interval '90 days' AND o.observed_at)::text AS median
       FROM price_observations o JOIN commodities c ON c.id = o.commodity_id JOIN markets m ON m.id = o.market_id
       WHERE o.status = $1 AND ($2::char(2) IS NULL OR o.country_iso2 = $2)
         AND ($3::timestamptz IS NULL OR (o.created_at, o.id) > ($3, $4::uuid))
       ORDER BY o.created_at, o.id LIMIT $5`, [q.status, country, c?.t ?? null, c?.id ?? null, q.limit + 1]);
    const page = rows.slice(0, q.limit);
    const ctx = await this.money.resolveDisplay(hints, user, country ?? undefined);
    const data = await Promise.all(page.map(async (r) => ({
      ...(await this.toObservation(r, ctx)), submittedBy: r.submitted_by, seriesMedianPerKg: r.median ? fmt(r.median, 4) : null,
      commodityName: r.commodity_name, marketName: r.market_name,
    })));
    const last = page[page.length - 1] as (ObsRow & { created_at?: Date }) | undefined;
    let nextCursor: string | null = null;
    if (rows.length > q.limit && last) {
      const t = await this.sql.one<{ created_at: Date }>(`SELECT created_at FROM price_observations WHERE id = $1`, [last.id]);
      nextCursor = cursor.encode({ t: t!.created_at.toISOString(), id: last.id });
    }
    return { data, nextCursor };
  }

  async review(id: string, action: "approve" | "reject", reason: string | undefined, user: AuthUser, hints: DisplayHints, client: ClientMeta) {
    const status = action === "approve" ? "approved" : "rejected";
    const row = await this.sql.one<ObsRow & { country_iso2: string }>(
      `UPDATE price_observations o SET status = $2, reviewed_by = $3, reviewed_at = now(), review_reason = $4
       WHERE o.id = $1 AND o.status IN ('pending','flagged') AND ($5::char(2) IS NULL OR o.country_iso2 = $5)
       RETURNING ${OBS_COLS}, o.country_iso2`, [id, status, user.id, reason ?? null, user.role === "admin" ? null : user.country]);
    if (!row) throw AppError.notFound("pending_observation");
    if (status === "approved") await this.ingest.onApproved(row.commodity_id, row.market_id, row.price_type, row.observed_at);
    // Approving an old observation changes history outside the CAGG policy window.
    if (Date.now() - row.observed_at.getTime() > 100 * 86_400_000) await this.queue.refreshAggregates({ from: row.observed_at.toISOString(), to: new Date(row.observed_at.getTime() + 86_400_000).toISOString() });
    await this.audit.record({ actorId: user.id, action: `price.review.${status}`, entity: "price_observation", entityId: id, data: { reason } }, client);
    return this.toObservation(row, await this.money.resolveDisplay(hints, user, row.country_iso2));
  }

  // ── read ──
  async latest(q: { commodity_id: string; country?: string; region_id?: string; price_type: string }, hints: DisplayHints, user: AuthUser | null) {
    const ctx = await this.money.resolveDisplay(hints, user, q.country);
    const rows = await this.sql.many<ObsRow & { market_name: Record<string, string>; region_id: string | null; prev: string | null }>(
      `SELECT DISTINCT ON (o.market_id) ${OBS_COLS}, m.name AS market_name, m.region_id,
         (SELECT avg_kg_local::text FROM price_daily d WHERE d.market_id = o.market_id AND d.commodity_id = o.commodity_id AND d.price_type = o.price_type
            AND d.bucket <= o.observed_at - interval '7 days' ORDER BY d.bucket DESC LIMIT 1) AS prev
       FROM price_observations o JOIN markets m ON m.id = o.market_id
       WHERE o.commodity_id = $1 AND o.price_type = $2 AND o.status = 'approved' AND o.country_iso2 = $3
         AND o.observed_at > now() - interval '120 days'
         AND ($4::uuid IS NULL OR m.region_id = $4 OR region_ancestor_at_level(m.region_id, (SELECT level FROM regions WHERE id = $4)) = $4)
       ORDER BY o.market_id, o.observed_at DESC`, [q.commodity_id, q.price_type, ctx.country, q.region_id ?? null]);
    const out = await Promise.all(rows.map(async (r) => ({
      marketId: r.market_id, marketName: r.market_name, regionId: r.region_id, priceType: r.price_type,
      value: await this.money.priceValue(r, ctx), observedAt: r.observed_at.toISOString(), changePctWoW: pctChange(r.price_per_kg_local, r.prev),
    })));
    return out.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  }

  /** Series from the daily/weekly continuous aggregate for a market, a region, or the whole country. */
  private async series(p: { commodityId: string; marketIds?: string[]; regionId?: string; country: string; priceType: string; days: number | null; interval: "day" | "week" }) {
    const view = p.interval === "week" ? "price_weekly" : "price_daily";
    return this.sql.many<{ market_id: string | null; t: Date; avg_local: string; avg_usd: string; min_local: string; max_local: string; n: number }>(
      `SELECT ${p.marketIds ? "d.market_id" : "NULL::uuid AS market_id"}, d.bucket AS t,
              (sum(d.sum_kg_local) / sum(d.n))::text AS avg_local, (sum(d.sum_kg_usd) / sum(d.n))::text AS avg_usd,
              min(d.min_kg_local)::text AS min_local, max(d.max_kg_local)::text AS max_local, sum(d.n)::int AS n
       FROM ${view} d
       WHERE d.commodity_id = $1 AND d.price_type = $2 AND d.country_iso2 = $3
         AND ($4::int IS NULL OR d.bucket >= now() - make_interval(days => $4))
         AND ($5::uuid[] IS NULL OR d.market_id = ANY($5))
         AND ($6::uuid IS NULL OR d.region_id = $6 OR region_ancestor_at_level(d.region_id, (SELECT level FROM regions WHERE id = $6)) = $6)
       GROUP BY ${p.marketIds ? "d.market_id, " : ""}d.bucket
       ORDER BY d.bucket`,
      [p.commodityId, p.priceType, p.country, p.days, p.marketIds ?? null, p.regionId ?? null]);
  }

  async history(q: { commodity_id: string; market_id?: string; region_id?: string; country?: string; price_type: string; range: string; interval: "day" | "week" }, hints: DisplayHints, user: AuthUser | null) {
    let country = q.country;
    if (q.market_id) country = (await this.geoRepo.market(q.market_id))?.country_iso2 ?? country;
    const ctx = await this.money.resolveDisplay(hints, user, country);
    const conv = await this.converter(q.commodity_id, ctx);
    const rows = await this.series({
      commodityId: q.commodity_id, marketIds: q.market_id ? [q.market_id] : undefined, regionId: q.region_id, country: ctx.country,
      priceType: q.price_type, days: RANGE_DAYS[q.range] ?? 90, interval: q.interval,
    });
    // Ratio of USD to local per row lets min/max follow the same FX basis as avg.
    const points = rows.map((r) => {
      const ratio = D(r.avg_usd).div(r.avg_local);
      return { t: r.t.toISOString(), avg: conv.conv(r.avg_local, r.avg_usd)!, min: conv.conv(r.min_local, D(r.min_local).mul(ratio).toString())!, max: conv.conv(r.max_local, D(r.max_local).mul(ratio).toString())!, n: r.n };
    });
    const s = seriesStats(points.map((p) => ({ t: new Date(p.t), avg: Number(p.avg) })));
    const f = (v: number | null) => (v == null ? null : v.toFixed(2));
    return {
      commodityId: q.commodity_id, marketId: q.market_id ?? null, regionId: q.region_id ?? null, priceType: q.price_type, range: q.range, interval: q.interval,
      currency: conv.currency, unit: conv.unit, localCurrency: ctx.localCurrency, points,
      stats: { high: f(s.high), low: f(s.low), average: f(s.average), latest: f(s.latest), changePctWoW: s.changePctWoW,
        volatility: { cv: s.volatility.cv, bandLow: f(s.volatility.bandLow), bandHigh: f(s.volatility.bandHigh), label: s.volatility.label } },
    };
  }

  async compare(q: { commodity_id: string; market_ids: string[]; price_type: string; range: string }, hints: DisplayHints, user: AuthUser | null) {
    const ids = [...new Set(q.market_ids)];
    const markets = await this.sql.many<{ id: string; name: Record<string, string>; country_iso2: string }>(`SELECT id, name, country_iso2 FROM markets WHERE id = ANY($1::uuid[])`, [ids]);
    if (markets.length !== ids.length) throw AppError.unprocessable("markets_unknown", "One or more markets were not found");
    const countries = new Set(markets.map((m) => m.country_iso2));
    const ctx = await this.money.resolveDisplay(hints, user, markets[0]!.country_iso2);
    const conv = await this.converter(q.commodity_id, ctx);
    const rows = countries.size === 1
      ? await this.series({ commodityId: q.commodity_id, marketIds: ids, country: ctx.country, priceType: q.price_type, days: RANGE_DAYS[q.range] ?? 30, interval: "day" })
      : (await Promise.all([...countries].map((c) => this.series({ commodityId: q.commodity_id, marketIds: ids, country: c, priceType: q.price_type, days: RANGE_DAYS[q.range] ?? 30, interval: "day" })))).flat();
    const latest = new Map((await this.geo.latestFor(q.commodity_id, q.price_type, ids)).map((l) => [l.market_id, l]));

    const out = await Promise.all(markets.map(async (m) => {
      const pts = rows.filter((r) => r.market_id === m.id).map((r) => ({ t: r.t.toISOString(), avg: conv.conv(r.avg_local, r.avg_usd)!, n: r.n }));
      const s = seriesStats(pts.map((p) => ({ t: new Date(p.t), avg: Number(p.avg) })));
      const l = latest.get(m.id);
      const f = (v: number | null) => (v == null ? null : v.toFixed(2));
      return {
        marketId: m.id, marketName: m.name, points: pts,
        latest: l ? { value: await this.money.priceValue(l, ctx), observedAt: l.observed_at.toISOString(), priceType: l.price_type } : null,
        stats: { high: f(s.high), low: f(s.low), average: f(s.average), latest: f(s.latest), changePctWoW: s.changePctWoW,
          volatility: { cv: s.volatility.cv, bandLow: f(s.volatility.bandLow), bandHigh: f(s.volatility.bandHigh), label: s.volatility.label } },
      };
    }));
    const withLatest = out.filter((m) => m.latest).sort((a, b) => Number(a.latest!.value.display.amount) - Number(b.latest!.value.display.amount));
    const lo = withLatest[0], hi = withLatest[withLatest.length - 1];
    return {
      commodityId: q.commodity_id, currency: conv.currency, unit: conv.unit, markets: out,
      cheapestMarketId: lo?.marketId ?? null, priciestMarketId: hi?.marketId ?? null,
      spreadPct: lo && hi && lo !== hi ? pctChange(hi.latest!.value.display.amount, lo.latest!.value.display.amount) : null,
    };
  }

  async regionalAverages(q: { commodity_id: string; country: string; price_type: string; days: number }, hints: DisplayHints, user: AuthUser | null) {
    const ctx = await this.money.resolveDisplay(hints, user, q.country);
    const conv = await this.converter(q.commodity_id, ctx);
    const rows = await this.sql.many<{ region_id: string; code: string; name: Record<string, string>; avg_local: string; avg_usd: string; n: number; markets: number }>(
      `SELECT r.id AS region_id, r.code, r.name, (sum(d.sum_kg_local) / sum(d.n))::text AS avg_local, (sum(d.sum_kg_usd) / sum(d.n))::text AS avg_usd,
              sum(d.n)::int AS n, count(DISTINCT d.market_id)::int AS markets
       FROM price_daily d JOIN regions r ON r.id = region_ancestor_at_level(d.region_id, 1)
       WHERE d.commodity_id = $1 AND d.country_iso2 = $2 AND d.price_type = $3 AND d.bucket >= now() - make_interval(days => $4)
       GROUP BY r.id, r.code, r.name ORDER BY avg_local`, [q.commodity_id, q.country, q.price_type, q.days]);
    return rows.map((r) => ({
      regionId: r.region_id, code: r.code, name: r.name, avg: conv.conv(r.avg_local, r.avg_usd)!, avgLocal: fmt(r.avg_local, 4),
      currency: conv.currency, unit: conv.unit, observations: r.n, marketCount: r.markets,
    }));
  }

  async trending(q: { country: string; price_type: string; window: "7d" | "30d"; direction: "up" | "down" | "both"; limit: number }, hints: DisplayHints, user: AuthUser | null) {
    const days = q.window === "30d" ? 30 : 7;
    const rows = await this.cache.wrap(`prices:trending:${q.country}:${q.price_type}:${days}`, 300, () =>
      this.sql.many<{ commodity_id: string; name: Record<string, string>; cur_local: string; prev_local: string; cur_usd: string; prev_usd: string; markets: number }>(
        // Compare only markets reporting in both windows so composition changes don't fake a move.
        `WITH w AS (
           SELECT commodity_id, market_id,
             sum(sum_kg_local) FILTER (WHERE bucket >= now() - make_interval(days => $3)) / nullif(sum(n) FILTER (WHERE bucket >= now() - make_interval(days => $3)), 0) AS cur_l,
             sum(sum_kg_local) FILTER (WHERE bucket < now() - make_interval(days => $3)) / nullif(sum(n) FILTER (WHERE bucket < now() - make_interval(days => $3)), 0) AS prev_l,
             sum(sum_kg_usd) FILTER (WHERE bucket >= now() - make_interval(days => $3)) / nullif(sum(n) FILTER (WHERE bucket >= now() - make_interval(days => $3)), 0) AS cur_u,
             sum(sum_kg_usd) FILTER (WHERE bucket < now() - make_interval(days => $3)) / nullif(sum(n) FILTER (WHERE bucket < now() - make_interval(days => $3)), 0) AS prev_u
           FROM price_daily
           WHERE country_iso2 = $1 AND price_type = $2 AND bucket >= now() - make_interval(days => $3 * 2)
           GROUP BY commodity_id, market_id
         )
         SELECT w.commodity_id, c.name, avg(cur_l)::text AS cur_local, avg(prev_l)::text AS prev_local, avg(cur_u)::text AS cur_usd, avg(prev_u)::text AS prev_usd,
                count(*)::int AS markets
         FROM w JOIN commodities c ON c.id = w.commodity_id
         WHERE cur_l IS NOT NULL AND prev_l IS NOT NULL
         GROUP BY w.commodity_id, c.name`, [q.country, q.price_type, days]));

    const ctx = await this.money.resolveDisplay(hints, user, q.country);
    const items = await Promise.all(rows.map(async (r) => {
      const conv = await this.converter(r.commodity_id, ctx);
      return {
        commodityId: r.commodity_id, commodityName: r.name, changePct: pctChange(r.cur_local, r.prev_local) ?? 0,
        current: conv.conv(r.cur_local, r.cur_usd)!, previous: conv.conv(r.prev_local, r.prev_usd)!, currency: conv.currency, unit: conv.unit, marketsReporting: r.markets,
      };
    }));
    return items
      .filter((i) => (q.direction === "up" ? i.changePct > 0 : q.direction === "down" ? i.changePct < 0 : true))
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
      .slice(0, q.limit);
  }

  async snapshot(country: string) {
    return this.cache.wrap(`prices:snapshot:${country}`, 120, async () => {
      const r = await this.sql.one<{ commodities: number; markets: number; regions: number; records: number; records7: number; last: Date | null }>(
        `SELECT
           (SELECT count(*) FROM commodity_country_profiles WHERE country_iso2 = $1 AND tracked)::int AS commodities,
           (SELECT count(*) FROM markets WHERE country_iso2 = $1 AND active)::int AS markets,
           (SELECT count(*) FROM regions WHERE country_iso2 = $1 AND level = 1)::int AS regions,
           (SELECT coalesce(sum(n), 0) FROM price_daily WHERE country_iso2 = $1)::bigint AS records,
           (SELECT coalesce(sum(n), 0) FROM price_daily WHERE country_iso2 = $1 AND bucket >= now() - interval '7 days')::bigint AS records7,
           (SELECT max(last_observed_at) FROM price_daily WHERE country_iso2 = $1 AND bucket >= now() - interval '30 days') AS last`, [country]);
      return { country, commodities: r!.commodities, markets: r!.markets, regions: r!.regions, priceRecords: r!.records, priceRecordsLast7d: r!.records7, lastUpdatedAt: r!.last?.toISOString() ?? null };
    });
  }
}
