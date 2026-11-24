import { Body, CanActivate, Controller, Delete, ExecutionContext, Get, HttpCode, Inject, Injectable, Module, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { Transform, Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from "class-validator";
import type { Request, Response } from "express";
import type Redis from "ioredis";
import { randomBytes } from "node:crypto";
import { AuthUser, CurrentUser, Public } from "../../common/auth/auth.common";
import { AuditService } from "../../common/audit/audit.service";
import { sha256 } from "../../common/crypto/crypto";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { cursor } from "../../common/http/request-context";
import { REDIS } from "../../common/redis/redis.module";
import { BillingService } from "../billing/billing.module";
import { CatalogueModule } from "../catalogue/catalogue.module";
import { CatalogueService } from "../catalogue/catalogue.service";
import { ForecastsModule } from "../forecasts/forecasts.module";
import { ForecastsService } from "../forecasts/forecasts.service";
import { GeoModule } from "../geo/geo.module";
import { GeoService } from "../geo/geo.service";
import { PagedQuery, PRICE_TYPES, upperIso } from "../geo/geo.dto";

const LICENCE = "AgriPrice data licence: attribution required. Upstream sources keep their own licences (e.g. WFP data is CC BY-IGO).";
const BURST_PER_MINUTE = 120;

interface ApiKeyCtx { keyId: string; ownerId: string; scopes: string[]; quota: number }

/** X-API-Key auth + per-plan daily quota (Redis counter, flushed to api_usage_daily) + per-minute burst limit. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly sql: Sql, @Inject(REDIS) private readonly redis: Redis, private readonly billing: BillingService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request & { apiKey?: ApiKeyCtx }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const raw = req.header("x-api-key");
    if (!raw || !/^ak_(live|test)_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{32,}$/.test(raw)) throw AppError.unauthorized("api_key_missing");
    const k = await this.sql.one<{ id: string; owner_id: string; org: string | null; scopes: string[]; suspended: boolean }>(
      `SELECT k.id, k.owner_id, u.organisation_id AS org, k.scopes, u.suspended_at IS NOT NULL OR u.deletion_scheduled_at IS NOT NULL AS suspended
       FROM api_keys k JOIN users u ON u.id = k.owner_id WHERE k.key_hash = $1 AND k.revoked_at IS NULL`, [sha256(raw)]);
    if (!k || k.suspended) throw AppError.unauthorized("api_key_invalid");
    const ent = await this.billing.entitlements({ id: k.owner_id, orgId: k.org });
    if (ent.api_daily_quota <= 0) throw new AppError(402, "upgrade_required", "Payment required", "API access needs a paid plan");

    const day = new Date().toISOString().slice(0, 10);
    const minute = Math.floor(Date.now() / 60_000);
    const out = (await this.redis.multi()
      .incr(`api:q:${k.id}:${day}`).expire(`api:q:${k.id}:${day}`, 2 * 86_400)
      .incr(`api:b:${k.id}:${minute}`).expire(`api:b:${k.id}:${minute}`, 120).exec()) as [Error | null, number][];
    const used = out[0]![1], burst = out[2]![1];
    res.setHeader("X-RateLimit-Limit", String(ent.api_daily_quota));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, ent.api_daily_quota - used)));
    if (burst > BURST_PER_MINUTE) throw AppError.tooMany("api_burst_limit", `Max ${BURST_PER_MINUTE} requests per minute`, 60);
    if (used > ent.api_daily_quota) throw AppError.tooMany("api_quota_exceeded", "Daily quota reached", 86_400 - Math.floor((Date.now() % 86_400_000) / 1000));
    if (used % 50 === 1) {
      // Periodic flush keeps DB writes low; the Redis counter is authoritative for the day.
      await this.sql.exec(`INSERT INTO api_usage_daily (key_id, day, calls) VALUES ($1,$2,$3) ON CONFLICT (key_id, day) DO UPDATE SET calls = greatest(api_usage_daily.calls, EXCLUDED.calls)`, [k.id, day, used]);
      await this.sql.exec(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [k.id]);
    }
    req.apiKey = { keyId: k.id, ownerId: k.owner_id, scopes: k.scopes, quota: ent.api_daily_quota };
    return true;
  }
}

class PublicMarketsQ extends PagedQuery { @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country: string }
class PublicCommoditiesQ extends PagedQuery { @IsOptional() @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country?: string }
class PublicPricesQ {
  @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country: string;
  @IsOptional() @IsUUID() commodity_id?: string;
  @IsOptional() @IsUUID() market_id?: string;
  @IsOptional() @IsIn(PRICE_TYPES) price_type?: string;
  @IsDateString() from: string;
  @IsDateString() to: string;
  @IsOptional() @IsString() @MaxLength(512) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) limit: number = 500;
}
class PublicForecastQ {
  @IsUUID() commodity_id: string;
  @IsOptional() @IsUUID() market_id?: string;
  @IsOptional() @IsUUID() region_id?: string;
  @IsOptional() @IsIn(PRICE_TYPES) price_type: string = "wholesale";
}
class KeyCreateDto { @IsString() @Length(1, 80) name: string }

@ApiTags("public-data")
@ApiBearerAuth()
@Controller("v1/api-keys")
export class ApiKeysController {
  constructor(private readonly sql: Sql, private readonly billing: BillingService, private readonly audit: AuditService, @Inject(REDIS) private readonly redis: Redis) {}

  private async dto(k: { id: string; name: string; prefix: string; scopes: string[]; last_used_at: Date | null; created_at: Date }, quota: number) {
    const used = Number(await this.redis.get(`api:q:${k.id}:${new Date().toISOString().slice(0, 10)}`)) || 0;
    return { id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, lastUsedAt: k.last_used_at?.toISOString() ?? null, createdAt: k.created_at.toISOString(), dailyQuota: quota, usedToday: used };
  }

  @Get() @ApiOperation({ operationId: "api_keys_list" })
  async list(@CurrentUser() u: AuthUser) {
    const quota = (await this.billing.entitlements(u)).api_daily_quota;
    const rows = await this.sql.many<{ id: string; name: string; prefix: string; scopes: string[]; last_used_at: Date | null; created_at: Date }>(`SELECT * FROM api_keys WHERE owner_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`, [u.id]);
    return Promise.all(rows.map((k) => this.dto(k, quota)));
  }

  @Post() @ApiOperation({ operationId: "api_keys_create" })
  async create(@CurrentUser() u: AuthUser, @Body() d: KeyCreateDto) {
    const ent = await this.billing.entitlements(u);
    const n = (await this.sql.one<{ n: number }>(`SELECT count(*)::int AS n FROM api_keys WHERE owner_id = $1 AND revoked_at IS NULL`, [u.id]))?.n ?? 0;
    if (ent.api_keys_max <= 0) throw new AppError(402, "upgrade_required", "Payment required", "API keys need a paid plan");
    if (n >= ent.api_keys_max) throw AppError.unprocessable("api_key_limit", `Your plan allows ${ent.api_keys_max} keys`);
    const env = process.env.NODE_ENV === "production" ? "live" : "test";
    const prefix = `ak_${env}_${randomBytes(6).toString("base64url").slice(0, 8)}`;
    const secret = `${prefix}_${randomBytes(32).toString("base64url")}`;
    const k = await this.sql.one<{ id: string; name: string; prefix: string; scopes: string[]; last_used_at: Date | null; created_at: Date }>(
      `INSERT INTO api_keys (owner_id, organisation_id, name, prefix, key_hash) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [u.id, u.orgId, d.name, prefix, sha256(secret)]);
    await this.audit.record({ actorId: u.id, action: "api_key.created", entity: "api_key", entityId: k!.id });
    return { ...(await this.dto(k!, ent.api_daily_quota)), secret };
  }

  @Delete(":id") @HttpCode(204) @ApiOperation({ operationId: "api_keys_revoke" })
  async revoke(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    if (!(await this.sql.exec(`UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND owner_id = $2 AND revoked_at IS NULL`, [id, u.id]))) throw AppError.notFound("api_key");
    await this.audit.record({ actorId: u.id, action: "api_key.revoked", entity: "api_key", entityId: id });
  }
}

@ApiTags("public-data")
@ApiSecurity("apiKeyAuth")
@Public()
@SkipThrottle()
@UseGuards(ApiKeyGuard)
@Controller("v1/public")
export class PublicDataController {
  constructor(private readonly sql: Sql, private readonly geo: GeoService, private readonly catalogue: CatalogueService, private readonly forecasts: ForecastsService) {}

  @Get("markets") @ApiOperation({ operationId: "public_markets" })
  markets(@Query() q: PublicMarketsQ) { return this.geo.markets(q); }

  @Get("commodities") @ApiOperation({ operationId: "public_commodities" })
  commodities(@Query() q: PublicCommoditiesQ) { return this.catalogue.commodities(q); }

  @Get("prices") @ApiOperation({ operationId: "public_prices" })
  async prices(@Query() q: PublicPricesQ) {
    const from = new Date(q.from), to = new Date(q.to);
    if (!(from <= to) || to.getTime() - from.getTime() > 3 * 366 * 86_400_000) throw AppError.unprocessable("range_invalid", "Use a range of up to 3 years");
    const c = cursor.decode<{ d: string; m: string; c: string; p: string }>(q.cursor);
    const rows = await this.sql.many<{ day: string; market_id: string; commodity_id: string; price_type: string; currency: string; avg: string; min: string; max: string; usd: string; n: number }>(
      `SELECT to_char(d.bucket, 'YYYY-MM-DD') AS day, d.market_id, d.commodity_id, d.price_type, co.currency,
              round(d.avg_kg_local, 4)::text AS avg, round(d.min_kg_local, 4)::text AS min, round(d.max_kg_local, 4)::text AS max, round(d.avg_kg_usd, 4)::text AS usd, d.n::int AS n
       FROM price_daily d JOIN countries co ON co.iso2 = d.country_iso2
       WHERE d.country_iso2 = $1 AND d.bucket BETWEEN $2::date AND $3::date
         AND ($4::uuid IS NULL OR d.commodity_id = $4) AND ($5::uuid IS NULL OR d.market_id = $5) AND ($6::text IS NULL OR d.price_type = $6)
         AND ($7::text IS NULL OR (to_char(d.bucket, 'YYYY-MM-DD'), d.market_id::text, d.commodity_id::text, d.price_type) > ($7, $8, $9, $10))
       ORDER BY 1, 2, 3, 4 LIMIT $11`,
      [q.country, q.from, q.to, q.commodity_id ?? null, q.market_id ?? null, q.price_type ?? null, c?.d ?? null, c?.m ?? null, c?.c ?? null, c?.p ?? null, q.limit + 1]);
    const page = rows.slice(0, q.limit); const last = page[page.length - 1];
    return {
      data: page.map((r) => ({ date: r.day, marketId: r.market_id, commodityId: r.commodity_id, priceType: r.price_type, currency: r.currency,
        avgPerKgLocal: r.avg, minPerKgLocal: r.min, maxPerKgLocal: r.max, avgPerKgUsd: r.usd, observations: r.n })),
      nextCursor: rows.length > q.limit && last ? cursor.encode({ d: last.day, m: last.market_id, c: last.commodity_id, p: last.price_type }) : null,
      licence: LICENCE,
    };
  }

  @Get("forecasts") @ApiOperation({ operationId: "public_forecasts" })
  forecast(@Query() q: PublicForecastQ) { return this.forecasts.get(q, { unit: "kg" }, null); }
}

@Module({ imports: [GeoModule, CatalogueModule, ForecastsModule], controllers: [ApiKeysController, PublicDataController], providers: [ApiKeyGuard] })
export class PublicDataModule {}
