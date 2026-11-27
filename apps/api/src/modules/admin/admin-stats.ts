import { Controller, Get, Injectable, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Matches } from "class-validator";
import { AuthUser, CurrentUser, Roles } from "../../common/auth/auth.common";
import { Sql } from "../../common/db/database.module";
import { Cache } from "../../common/redis/redis.module";
import { upperIso } from "../geo/geo.dto";

export class StatsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @IsIn([7, 30, 90]) days: 7 | 30 | 90 = 30;
  @IsOptional() @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country?: string;
}

/** Zero-filled daily series: every day in the window appears, so charts never skip a quiet day (exported for tests). */
export function fillDays<T extends Record<string, number>>(rows: ({ d: string } & Partial<T>)[], days: number, keys: (keyof T)[], today = new Date()): ({ date: string } & T)[] {
  const by = new Map(rows.map((r) => [r.d, r]));
  const out: ({ date: string } & T)[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i)).toISOString().slice(0, 10);
    const r = by.get(day);
    out.push({ date: day, ...Object.fromEntries(keys.map((k) => [k, Number(r?.[k] ?? 0)])) } as { date: string } & T);
  }
  return out;
}

const n = (v: unknown) => Number(v ?? 0);

/**
 * Totals behind the admin overview charts. Counts are exact (not the first page of a queue). An org admin sees their own
 * country, and money/moderation queues (admin-only screens) come back null for them. Cached for a minute.
 */
@Injectable()
export class AdminStatsService {
  constructor(private readonly sql: Sql, private readonly cache: Cache) {}

  async stats(actor: AuthUser, q: StatsQuery) {
    const country = actor.role === "admin" ? q.country ?? null : actor.country;
    const admin = actor.role === "admin";
    const days = q.days ?? 30;
    return this.cache.wrap(`admin:stats:${country ?? "all"}:${days}:${admin ? "a" : "o"}`, 60, async () => {
      const [queues, roles, signups, prices, orderStatus, orderDays, confidence] = await Promise.all([
        this.sql.one<Record<string, string>>(
          `SELECT
             (SELECT count(*) FROM price_observations WHERE status = 'pending' AND ($1::char(2) IS NULL OR country_iso2 = $1)) AS prices_pending,
             (SELECT count(*) FROM price_observations WHERE status = 'flagged' AND ($1::char(2) IS NULL OR country_iso2 = $1)) AS prices_flagged,
             (SELECT count(*) FROM seller_profiles WHERE kyc_status = 'pending' AND ($1::char(2) IS NULL OR country_iso2 = $1)) AS seller_applications,
             (SELECT count(*) FROM moderation_items WHERE status = 'open') AS moderation_open,
             (SELECT count(*) FROM disputes WHERE status IN ('open','under_review')) AS disputes_open,
             (SELECT count(*) FROM payouts WHERE status = 'pending_review') AS payouts_pending`, [country]),
        this.sql.many<{ role: string; c: string }>(
          `SELECT role, count(*) AS c FROM users WHERE deletion_scheduled_at IS NULL AND ($1::char(2) IS NULL OR country_iso2 = $1) GROUP BY role ORDER BY count(*) DESC`, [country]),
        this.sql.many<{ d: string; count: string }>(
          `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*) AS count FROM users
           WHERE created_at >= (now() AT TIME ZONE 'UTC')::date - ($2::int - 1) AND ($1::char(2) IS NULL OR country_iso2 = $1) GROUP BY 1`, [country, days]),
        this.sql.many<{ d: string; approved: string; pending: string; flagged: string; rejected: string }>(
          `SELECT to_char(observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d,
                  count(*) FILTER (WHERE status = 'approved') AS approved, count(*) FILTER (WHERE status = 'pending') AS pending,
                  count(*) FILTER (WHERE status = 'flagged') AS flagged, count(*) FILTER (WHERE status = 'rejected') AS rejected
           FROM price_observations WHERE observed_at >= (now() AT TIME ZONE 'UTC')::date - ($2::int - 1) AND ($1::char(2) IS NULL OR country_iso2 = $1) GROUP BY 1`, [country, days]),
        this.sql.many<{ status: string; c: string }>(
          `SELECT status, count(*) AS c FROM orders WHERE created_at >= now() - make_interval(days => $2) AND ($1::char(2) IS NULL OR country_iso2 = $1) GROUP BY status ORDER BY count(*) DESC`, [country, days]),
        this.sql.many<{ d: string; count: string }>(
          `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*) AS count FROM orders
           WHERE created_at >= (now() AT TIME ZONE 'UTC')::date - ($2::int - 1) AND ($1::char(2) IS NULL OR country_iso2 = $1) GROUP BY 1`, [country, days]),
        this.sql.many<{ horizon_months: number; confidence: string; c: string }>(
          `SELECT p.horizon_months, p.confidence, count(*) AS c FROM forecast_points p JOIN forecast_runs r ON r.id = p.forecast_id
           WHERE r.is_latest AND ($1::char(2) IS NULL OR r.country_iso2 = $1) GROUP BY 1, 2 ORDER BY 1, 2`, [country]),
      ]);
      const byRole = roles.map((r) => ({ role: r.role, count: n(r.c) }));
      const signupSeries = fillDays<{ count: number }>(signups.map((r) => ({ d: r.d, count: n(r.count) })), days, ["count"]);
      return {
        days, country, generatedAt: new Date().toISOString(),
        queues: {
          pricesPending: n(queues?.prices_pending), pricesFlagged: n(queues?.prices_flagged), sellerApplications: n(queues?.seller_applications),
          moderationOpen: admin ? n(queues?.moderation_open) : null, disputesOpen: admin ? n(queues?.disputes_open) : null, payoutsPending: admin ? n(queues?.payouts_pending) : null,
        },
        users: { total: byRole.reduce((a, r) => a + r.count, 0), newInPeriod: signupSeries.reduce((a, r) => a + r.count, 0), byRole },
        signups: signupSeries,
        prices: fillDays<{ approved: number; pending: number; flagged: number; rejected: number }>(
          prices.map((r) => ({ d: r.d, approved: n(r.approved), pending: n(r.pending), flagged: n(r.flagged), rejected: n(r.rejected) })), days, ["approved", "pending", "flagged", "rejected"]),
        orders: { byStatus: orderStatus.map((r) => ({ status: r.status, count: n(r.c) })), perDay: fillDays<{ count: number }>(orderDays.map((r) => ({ d: r.d, count: n(r.count) })), days, ["count"]) },
        forecastConfidence: confidence.map((r) => ({ horizonMonths: r.horizon_months, confidence: r.confidence, count: n(r.c) })),
      };
    });
  }
}

@ApiTags("admin")
@ApiBearerAuth()
@Roles("admin", "org_admin")
@Controller("v1/admin/stats")
export class AdminStatsController {
  constructor(private readonly s: AdminStatsService) {}

  @Get() @ApiOperation({ operationId: "admin_stats" })
  stats(@CurrentUser() u: AuthUser, @Query() q: StatsQuery) { return this.s.stats(u, q); }
}
