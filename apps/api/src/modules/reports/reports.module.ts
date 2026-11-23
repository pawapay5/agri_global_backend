import { Body, Controller, Get, Headers, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Query, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from "class-validator";
import type { Response } from "express";
import { randomBytes } from "node:crypto";
import { AuthUser, CurrentUser, Public } from "../../common/auth/auth.common";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { cursor } from "../../common/http/request-context";
import { QueueService } from "../../common/queue/queues";
import { StorageService } from "../../common/storage/storage.service";
import { BillingService } from "../billing/billing.module";
import { PagedQuery, PRICE_TYPES } from "../geo/geo.dto";

class ReportCreateDto {
  @IsIn(["crop_price", "market_analysis", "forecast", "regional", "custom", "seller_performance"]) type: string;
  @IsIn(["pdf", "xlsx", "csv"]) format: string;
  @Matches(/^[A-Z]{2}$/) country: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID("all", { each: true }) commodityIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsUUID("all", { each: true }) marketIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID("all", { each: true }) regionIds?: string[];
  @IsDateString() from: string;
  @IsDateString() to: string;
  @IsOptional() @IsIn(PRICE_TYPES) priceType?: string;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsString() @MaxLength(32) unit?: string;
  @IsOptional() @IsArray() @IsIn(["summary", "history", "comparison", "regional", "seasonal", "forecast", "explanations"], { each: true }) sections?: string[];
}

export const shortCode = () => randomBytes(8).toString("base64url").replace(/[-_]/g, "").slice(0, 8).padEnd(8, "0");

@Injectable()
export class ReportsService {
  constructor(private readonly sql: Sql, private readonly queue: QueueService, private readonly storage: StorageService, private readonly billing: BillingService) {}

  private async dto(r: Record<string, any>) {
    let downloadUrl: string | null = null, expires: string | null = null;
    if (r.status === "succeeded" && r.object_key) {
      downloadUrl = await this.storage.signedGetUrl(this.storage.cfg.s3.reportsBucket, r.object_key, 86_400, `agriprice-${r.type}-${r.created_at.toISOString().slice(0, 10)}.${r.format}`);
      expires = new Date(Date.now() + 86_400_000).toISOString();
    }
    return {
      id: r.id, type: r.type, format: r.format, status: r.status, params: r.params, downloadUrl, downloadUrlExpiresAt: expires,
      shortUrl: r.short_code ? `${process.env.API_PUBLIC_URL ?? "https://api.agriprice.app"}/s/${r.short_code}` : null,
      bytes: r.bytes, error: r.error, createdAt: r.created_at.toISOString(), finishedAt: r.finished_at?.toISOString() ?? null,
    };
  }

  async create(user: AuthUser, d: ReportCreateDto, idem?: string) {
    const from = new Date(d.from), to = new Date(d.to);
    if (!(from < to)) throw AppError.unprocessable("range_invalid", "`from` must be before `to`");
    if (to.getTime() - from.getTime() > 5 * 366 * 86_400_000) throw AppError.unprocessable("range_too_long", "Reports cover at most 5 years");
    if (d.type === "seller_performance") {
      if (!(await this.sql.one(`SELECT 1 FROM seller_profiles WHERE user_id = $1`, [user.id]))) throw AppError.unprocessable("seller_profile_required", "Seller reports need a seller profile");
    } else if (!(d.commodityIds?.length || d.marketIds?.length)) throw AppError.unprocessable("scope_required", "Select at least one crop or market");
    const ent = await this.billing.entitlements(user);
    if (!ent.report_formats.includes(d.format)) throw new AppError(402, "upgrade_required", "Payment required", `${d.format.toUpperCase()} reports need a paid plan`, { feature: "report_formats" });
    const used = (await this.sql.one<{ n: number }>(`SELECT count(*)::int AS n FROM report_jobs WHERE user_id = $1 AND created_at >= date_trunc('month', now()) AND status <> 'failed'`, [user.id]))?.n ?? 0;
    if (used >= ent.reports_per_month) throw new AppError(402, "report_quota_exceeded", "Payment required", `Your plan includes ${ent.reports_per_month} reports per month`, { feature: "reports_per_month" });
    if (idem) {
      const prev = await this.sql.one(`SELECT * FROM report_jobs WHERE user_id = $1 AND params->>'idempotencyKey' = $2`, [user.id, idem]);
      if (prev) return this.dto(prev);
    }
    const prefs = await this.sql.one<{ locale: string | null; currency: string | null; unit: string | null }>(`SELECT locale, currency, unit FROM user_preferences WHERE user_id = $1`, [user.id]);
    // Seller reports are always scoped to the caller: the seller id comes from the session, never the body.
    const params = { ...d, sellerId: d.type === "seller_performance" ? user.id : undefined, currency: d.currency ?? prefs?.currency ?? undefined, unit: d.unit ?? prefs?.unit ?? undefined, locale: prefs?.locale ?? "en", idempotencyKey: idem ?? undefined };
    const r = await this.sql.one(`INSERT INTO report_jobs (user_id, type, format, params) VALUES ($1,$2,$3,$4) RETURNING *`, [user.id, d.type, d.format, JSON.stringify(params)]);
    await this.queue.raw("reports", "generate", { reportId: r!.id }, `report_${r!.id}`, { attempts: 3 });
    return this.dto(r!);
  }

  async list(user: AuthUser, q: { cursor?: string; limit: number }) {
    const c = cursor.decode<{ t: string; id: string }>(q.cursor);
    const rows = await this.sql.many(`SELECT * FROM report_jobs WHERE user_id = $1 AND ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3::uuid)) ORDER BY created_at DESC, id DESC LIMIT $4`,
      [user.id, c?.t ?? null, c?.id ?? null, q.limit + 1]);
    const page = rows.slice(0, q.limit); const last = page[page.length - 1];
    return { data: await Promise.all(page.map((r) => this.dto(r))), nextCursor: rows.length > q.limit && last ? cursor.encode({ t: last.created_at.toISOString(), id: last.id }) : null };
  }

  async get(user: AuthUser, id: string) {
    const r = await this.sql.one(`SELECT * FROM report_jobs WHERE id = $1 AND user_id = $2`, [id, user.id]);
    if (!r) throw AppError.notFound("report");
    return this.dto(r);
  }

  /** Short links always mint a fresh signed URL, so a shared link outlives any single 24 h URL until the link itself expires. */
  async resolve(code: string): Promise<string> {
    const l = await this.sql.one<{ target_type: string; target_id: string; expires_at: Date | null }>(`SELECT target_type, target_id, expires_at FROM short_links WHERE code = $1`, [code]);
    if (!l) throw AppError.notFound("link");
    if (l.expires_at && l.expires_at < new Date()) throw new AppError(410, "link_expired", "Gone", "This link has expired");
    const web = process.env.WEB_URL ?? "https://agriprice.app";
    if (l.target_type === "report") {
      const r = await this.sql.one<{ object_key: string | null; status: string; type: string; format: string; created_at: Date }>(`SELECT object_key, status, type, format, created_at FROM report_jobs WHERE id = $1`, [l.target_id]);
      if (!r?.object_key || r.status !== "succeeded") throw AppError.notFound("report");
      return this.storage.signedGetUrl(this.storage.cfg.s3.reportsBucket, r.object_key, 86_400, `agriprice-${r.type}-${r.created_at.toISOString().slice(0, 10)}.${r.format}`);
    }
    return `${web}/${l.target_type === "listing" ? "marketplace/listings" : "community/posts"}/${l.target_id}`;
  }
}

@ApiTags("reports")
@ApiBearerAuth()
@Controller()
export class ReportsController {
  constructor(private readonly r: ReportsService) {}

  @Post("v1/reports") @HttpCode(202) @ApiOperation({ operationId: "reports_create" })
  create(@CurrentUser() u: AuthUser, @Body() d: ReportCreateDto, @Headers("idempotency-key") key?: string) { return this.r.create(u, d, key?.slice(0, 128)); }

  @Get("v1/reports") @ApiOperation({ operationId: "reports_list" })
  list(@CurrentUser() u: AuthUser, @Query() q: PagedQuery) { return this.r.list(u, q); }

  @Get("v1/reports/:id") @ApiOperation({ operationId: "reports_get" })
  get(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { return this.r.get(u, id); }

  @Public() @Get("s/:code") @ApiOperation({ operationId: "short_link_resolve" })
  async resolve(@Param("code") code: string, @Res() res: Response) {
    if (!/^[0-9A-Za-z]{6,12}$/.test(code)) throw AppError.notFound("link");
    res.redirect(302, await this.r.resolve(code));
  }
}

@Module({ controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
