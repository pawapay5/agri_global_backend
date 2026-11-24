import { Body, Controller, Get, HttpCode, Inject, Injectable, Module, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";
import type { Request } from "express";
import type Redis from "ioredis";
import { AuthUser, CurrentUser, Public } from "../../common/auth/auth.common";
import { safeEqual } from "../../common/crypto/crypto";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { I18nService } from "../../common/i18n/i18n.service";
import { QueueService } from "../../common/queue/queues";
import { REDIS } from "../../common/redis/redis.module";
import { upperIso } from "../geo/geo.dto";
import { activityScore, demandIndex, PERIOD_DAYS, periodChangePct, supplyShares } from "./analytics.logic";

class PeriodQ { @IsOptional() @IsIn(["7d", "30d", "90d", "365d"]) period: string = "30d" }
class SeriesQ extends PeriodQ {
  @IsIn(["revenue", "orders", "views", "offers", "kg_sold"]) metric: string;
  @IsOptional() @IsIn(["day", "week"]) interval: "day" | "week" = "day";
}
class TopQ extends PeriodQ { @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit: number = 10 }
class DemandQ {
  @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country: string;
  @IsUUID() commodity_id: string;
  @IsOptional() @IsUUID() region_id?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(8) @Max(104) weeks: number = 26;
}
class SupplyQ { @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country: string; @IsUUID() commodity_id: string }
class RefreshedDto { @Matches(/^[A-Z]{2}$/) country: string; @IsOptional() @IsString() @MaxLength(80) modelVersion?: string; @IsOptional() @IsInt() series?: number }

const SERIES_SQL: Record<string, string> = { revenue: "sum(revenue)", orders: "sum(orders_placed)", views: "sum(views)", offers: "sum(offers)", kg_sold: "sum(kg_sold)" };

@Injectable()
export class SellerAnalyticsService {
  constructor(private readonly sql: Sql, private readonly i18n: I18nService) {}

  private async currency(user: AuthUser) {
    return (await this.sql.one<{ currency: string }>(`SELECT currency FROM countries WHERE iso2 = $1`, [user.country]))!.currency;
  }

  async summary(user: AuthUser, period: string) {
    const days = PERIOD_DAYS[period]!;
    const cur = await this.currency(user);
    const agg = (from: number, to: number) => this.sql.one<{ revenue: number; placed: number; completed: number; cancelled: number; views: number }>(
      `SELECT coalesce(sum(revenue), 0)::float8 AS revenue, coalesce(sum(orders_placed), 0)::int AS placed, coalesce(sum(orders_completed), 0)::int AS completed,
              coalesce(sum(orders_cancelled), 0)::int AS cancelled, coalesce(sum(views), 0)::int AS views
       FROM seller_daily WHERE seller_id = $1 AND bucket >= now() - make_interval(days => $2) AND bucket < now() - make_interval(days => $3)`, [user.id, from, to]);
    // Active buyers need a distinct count, which caggs can't hold, so they come from the raw hypertable (indexed on seller_id, at).
    const buyers = (from: number, to: number) => this.sql.one<{ n: number }>(
      `SELECT count(DISTINCT buyer_id)::int AS n FROM marketplace_events WHERE seller_id = $1 AND kind = 'order_placed'
         AND at >= now() - make_interval(days => $2) AND at < now() - make_interval(days => $3)`, [user.id, from, to]);
    const [c, p, bc, bp, listings] = await Promise.all([agg(days, 0), agg(days * 2, days), buyers(days, 0), buyers(days * 2, days),
      this.sql.one<{ n: number }>(`SELECT count(*)::int AS n FROM listings WHERE seller_id = $1 AND status IN ('active','low_stock')`, [user.id])]);
    const kpi = (v: number, prev: number) => ({ value: Math.round(v * 100) / 100, previous: Math.round(prev * 100) / 100, changePct: periodChangePct(v, prev) });
    const conv = (o: number, v: number) => (v ? Math.round((o / v) * 10_000) / 100 : 0);
    return {
      period, currency: cur,
      revenue: kpi(c!.revenue, p!.revenue), ordersPlaced: kpi(c!.placed, p!.placed), ordersCompleted: kpi(c!.completed, p!.completed),
      activeBuyers: kpi(bc!.n, bp!.n), views: kpi(c!.views, p!.views), conversionPct: kpi(conv(c!.placed, c!.views), conv(p!.placed, p!.views)),
      activeListings: listings!.n, cancellationRatePct: c!.placed ? Math.round((c!.cancelled / c!.placed) * 10_000) / 100 : null,
    };
  }

  async series(user: AuthUser, q: SeriesQ) {
    const rows = await this.sql.many<{ t: Date; v: number }>(
      `SELECT time_bucket(${q.interval === "week" ? "'7 days'" : "'1 day'"}, bucket) AS t, coalesce(${SERIES_SQL[q.metric]}, 0)::float8 AS v
       FROM seller_daily WHERE seller_id = $1 AND bucket >= now() - make_interval(days => $2) GROUP BY 1 ORDER BY 1`, [user.id, PERIOD_DAYS[q.period]]);
    return { metric: q.metric, currency: await this.currency(user), points: rows.map((r) => ({ t: r.t.toISOString(), value: Math.round(r.v * 100) / 100 })) };
  }

  async top(user: AuthUser, q: TopQ) {
    const rows = await this.sql.many<{ listing_id: string; title: string; commodity_id: string | null; revenue: number; kg: number; orders: number; views: number }>(
      `SELECT d.listing_id, l.title, d.commodity_id, sum(d.revenue)::float8 AS revenue, sum(d.kg_sold)::float8 AS kg, sum(d.orders)::int AS orders, sum(d.views)::int AS views
       FROM listing_daily d JOIN listings l ON l.id = d.listing_id
       WHERE d.seller_id = $1 AND d.bucket >= now() - make_interval(days => $2) GROUP BY 1, 2, 3 ORDER BY revenue DESC, orders DESC LIMIT $3`, [user.id, PERIOD_DAYS[q.period], q.limit]);
    return rows.map((r) => ({ listingId: r.listing_id, title: r.title, commodityId: r.commodity_id, revenue: Math.round(r.revenue * 100) / 100, kgSold: r.kg, orders: r.orders, views: r.views,
      conversionPct: r.views ? Math.round((r.orders / r.views) * 10_000) / 100 : null }));
  }

  async demand(q: DemandQ, locale: string) {
    const weeks = q.weeks + 12; // baseline window
    const act = await this.sql.many<{ week: Date; views: number; favourites: number; offers: number; orders: number; kg: number }>(
      `SELECT d.bucket AS week, sum(views)::int AS views, sum(favourites)::int AS favourites, sum(offers)::int AS offers, sum(orders)::int AS orders, sum(kg_ordered)::float8 AS kg
       FROM demand_weekly d WHERE d.country_iso2 = $1 AND d.commodity_id = $2 AND d.bucket >= now() - make_interval(weeks => $3)
         AND ($4::uuid IS NULL OR region_ancestor_at_level(d.region_id, 1) = $4) GROUP BY 1 ORDER BY 1`, [q.country, q.commodity_id, weeks, q.region_id ?? null]);
    const prices = await this.sql.many<{ week: Date; p: number }>(
      `SELECT bucket AS week, (sum(sum_kg_local) / nullif(sum(n), 0))::float8 AS p FROM price_weekly
       WHERE country_iso2 = $1 AND commodity_id = $2 AND bucket >= now() - make_interval(weeks => $3)
         AND ($4::uuid IS NULL OR region_ancestor_at_level(region_id, 1) = $4) GROUP BY 1 ORDER BY 1`, [q.country, q.commodity_id, weeks, q.region_id ?? null]);
    // Align on a continuous weekly grid (weeks with no activity are zeros, not gaps).
    const start = new Date(Date.now() - weeks * 7 * 86_400_000);
    const grid: Date[] = [];
    for (let t = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())); t <= new Date(); t = new Date(t.getTime() + 7 * 86_400_000)) grid.push(t);
    const wk = (d: Date) => Math.floor(d.getTime() / (7 * 86_400_000));
    const aMap = new Map(act.map((a) => [wk(a.week), a])); const pMap = new Map(prices.map((p) => [wk(p.week), p.p]));
    const actS = grid.map((g) => { const a = aMap.get(wk(g)); return a ? activityScore(a) : 0; });
    const priceS = grid.map((g) => pMap.get(wk(g)) ?? null);
    const idx = demandIndex(actS, priceS);
    const points = grid.map((g, i) => ({ week: g.toISOString().slice(0, 10), index: idx[i] ?? null, activity: actS[i]!, kgOrdered: aMap.get(wk(g))?.kg ?? 0, avgPricePerKg: priceS[i] != null ? Math.round(priceS[i]! * 100) / 100 : null })).slice(-q.weeks);

    let byRegion: { regionId: string; name: string; index: number | null }[] = [];
    if (!q.region_id) {
      const reg = await this.sql.many<{ region_id: string; name: Record<string, string>; recent: number; base: number }>(
        `SELECT r.id AS region_id, r.name,
                coalesce(sum(views + 3 * favourites + 8 * offers + 20 * orders) FILTER (WHERE d.bucket >= now() - interval '4 weeks'), 0)::float8 / 4 AS recent,
                coalesce(sum(views + 3 * favourites + 8 * offers + 20 * orders) FILTER (WHERE d.bucket < now() - interval '4 weeks'), 0)::float8 / 12 AS base
         FROM demand_weekly d JOIN regions r ON r.id = region_ancestor_at_level(d.region_id, 1)
         WHERE d.country_iso2 = $1 AND d.commodity_id = $2 AND d.bucket >= now() - interval '16 weeks' GROUP BY 1, 2`, [q.country, q.commodity_id]);
      byRegion = reg.map((r) => ({ regionId: r.region_id, name: this.i18n.pick(r.name, locale), index: r.base > 0 ? Math.round((r.recent / r.base) * 1000) / 10 : null }))
        .sort((a, b) => (b.index ?? -1) - (a.index ?? -1));
    }
    return { commodityId: q.commodity_id, regionId: q.region_id ?? null, points, byRegion,
      method: "100 × (activity ÷ trailing-12-week mean)^0.7 × (4-week ÷ 12-week mean price)^0.3; activity = views + 3·favourites + 8·offers + 20·orders" };
  }

  async supply(q: SupplyQ, locale: string) {
    const latest = await this.sql.one<{ at: Date }>(`SELECT max(at) AS at FROM supply_snapshots WHERE country_iso2 = $1 AND commodity_id = $2`, [q.country, q.commodity_id]);
    if (!latest?.at) return { commodityId: q.commodity_id, snapshotAt: null, totalKg: 0, regions: [] };
    const rows = await this.sql.many<{ region_id: string | null; name: Record<string, string> | null; kg: number; listings: number; sellers: number; prev: number | null }>(
      `SELECT s.region_id, r.name, s.quantity_kg::float8 AS kg, s.listings, s.sellers,
              (SELECT p.quantity_kg::float8 FROM supply_snapshots p WHERE p.country_iso2 = s.country_iso2 AND p.commodity_id = s.commodity_id
                 AND p.region_id IS NOT DISTINCT FROM s.region_id AND p.at <= s.at - interval '27 days' ORDER BY p.at DESC LIMIT 1) AS prev
       FROM supply_snapshots s LEFT JOIN regions r ON r.id = s.region_id WHERE s.country_iso2 = $1 AND s.commodity_id = $2 AND s.at = $3`, [q.country, q.commodity_id, latest.at]);
    const shares = supplyShares(rows.map((r) => ({ regionId: r.region_id, quantityKg: r.kg })));
    return {
      commodityId: q.commodity_id, snapshotAt: latest.at.toISOString(), totalKg: shares.reduce((s, r) => s + r.quantityKg, 0),
      regions: shares.map((s) => {
        const r = rows.find((x) => x.region_id === s.regionId)!;
        return { ...s, name: r.name ? this.i18n.pick(r.name, locale) : "Unknown region", listings: r.listings, sellers: r.sellers, change4wPct: r.prev != null ? periodChangePct(r.kg, r.prev) : null };
      }),
    };
  }
}

@ApiTags("seller-analytics")
@ApiBearerAuth()
@Controller("v1")
export class SellerAnalyticsController {
  constructor(private readonly a: SellerAnalyticsService) {}

  @Get("seller/analytics/summary") @ApiOperation({ operationId: "seller_analytics_summary" })
  summary(@CurrentUser() u: AuthUser, @Query() q: PeriodQ) { return this.a.summary(u, q.period); }

  @Get("seller/analytics/timeseries") @ApiOperation({ operationId: "seller_analytics_timeseries" })
  series(@CurrentUser() u: AuthUser, @Query() q: SeriesQ) { return this.a.series(u, q); }

  @Get("seller/analytics/top-products") @ApiOperation({ operationId: "seller_analytics_top_products" })
  top(@CurrentUser() u: AuthUser, @Query() q: TopQ) { return this.a.top(u, q); }

  @Get("market-intel/demand") @ApiOperation({ operationId: "market_intel_demand" })
  demand(@Query() q: DemandQ, @Req() req: Request) { return this.a.demand(q, req.header("accept-language")?.split(",")[0] ?? "en"); }

  @Get("market-intel/supply") @ApiOperation({ operationId: "market_intel_supply" })
  supply(@Query() q: SupplyQ, @Req() req: Request) { return this.a.supply(q, req.header("accept-language")?.split(",")[0] ?? "en"); }
}

/** Service hook for the nightly ML flow: drop cached forecast-derived responses and re-run alerts. */
@ApiTags("internal")
@Public()
@SkipThrottle()
@Controller("internal")
export class InternalController {
  constructor(@Inject(REDIS) private readonly redis: Redis, private readonly queue: QueueService) {}

  @Post("forecasts/refreshed") @HttpCode(202) @ApiOperation({ operationId: "internal_forecasts_refreshed" })
  async refreshed(@Req() req: Request, @Body() d: RefreshedDto) {
    const token = process.env.ML_SERVICE_TOKEN;
    const got = req.header("authorization")?.replace(/^Bearer /, "");
    if (!token || !got || !safeEqual(token, got)) throw AppError.unauthorized("internal_token_invalid");
    // Forecast/insight/trending caches are short-lived Redis keys: delete by pattern (SCAN, non-blocking).
    for (const pattern of [`prices:trending:${d.country}:*`, `prices:snapshot:${d.country}`, `content:impact:*`]) {
      let c = "0";
      do { const [next, keys] = await this.redis.scan(c, "MATCH", pattern, "COUNT", 500); c = next; if (keys.length) await this.redis.del(...keys); } while (c !== "0");
    }
    await this.queue.raw("alerts", "sweep", {}, `sweep_after_forecast_${d.country}_${Date.now()}`);
    return { ok: true };
  }
}

@Module({ controllers: [SellerAnalyticsController, InternalController], providers: [SellerAnalyticsService] })
export class SellerAnalyticsModule {}
