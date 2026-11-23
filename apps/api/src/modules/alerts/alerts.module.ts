import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";
import { AuthUser, CurrentUser } from "../../common/auth/auth.common";
import { AuditService } from "../../common/audit/audit.service";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { Client, ClientMeta, cursor } from "../../common/http/request-context";
import { D, fmt } from "../../common/money/money.math";
import { MoneyService } from "../../common/money/money.service";
import { PagedQuery, PRICE_TYPES } from "../geo/geo.dto";

const CHANNELS = ["push", "email", "sms", "whatsapp", "in_app"] as const;
const DECIMAL = /^-?\d{1,12}(\.\d{1,6})?$/;
const MAX_ALERTS_PER_USER = 50;

export class AlertCreateDto {
  @ApiProperty() @IsUUID() commodityId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() marketId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() regionId?: string;
  @ApiPropertyOptional({ enum: PRICE_TYPES }) @IsOptional() @IsIn(PRICE_TYPES) priceType: string = "wholesale";
  @ApiProperty({ enum: ["above", "below", "pct_change"] }) @IsIn(["above", "below", "pct_change"]) condition: "above" | "below" | "pct_change";
  @ApiProperty() @Matches(DECIMAL) threshold: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{3}$/) thresholdCurrency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) thresholdUnit?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(90) pctWindowDays: number = 7;
  @ApiProperty({ enum: CHANNELS, isArray: true }) @IsArray() @ArrayMinSize(1) @IsIn(CHANNELS, { each: true }) channels: string[];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(168) cooldownHours: number = 24;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active: boolean = true;
}

export class AlertUpdateDto {
  @ApiPropertyOptional() @IsOptional() @Matches(DECIMAL) threshold?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(["above", "below", "pct_change"]) condition?: "above" | "below" | "pct_change";
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(90) pctWindowDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMinSize(1) @IsIn(CHANNELS, { each: true }) channels?: string[];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(168) cooldownHours?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

class AlertsListQuery { @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => (value === "true" ? true : value === "false" ? false : value)) @IsBoolean() active?: boolean }
class HistoryQuery extends PagedQuery { @ApiPropertyOptional() @IsOptional() @IsUUID() alert_id?: string }

interface AlertRow {
  id: string; commodity_id: string; market_id: string | null; region_id: string | null; country_iso2: string; price_type: string; condition: string; threshold: string;
  threshold_currency: string | null; threshold_unit: string | null; threshold_per_kg_local: string | null; pct_window_days: number; channels: string[]; cooldown_hours: number;
  active: boolean; last_triggered_at: Date | null; trigger_count: number; created_at: Date; updated_at: Date;
}

@Injectable()
export class AlertsService {
  constructor(private readonly sql: Sql, private readonly money: MoneyService, private readonly audit: AuditService) {}

  private dto(a: AlertRow) {
    return {
      id: a.id, commodityId: a.commodity_id, marketId: a.market_id ?? undefined, regionId: a.region_id ?? undefined, priceType: a.price_type, condition: a.condition,
      threshold: fmt(a.threshold, a.condition === "pct_change" ? 2 : 2), thresholdCurrency: a.threshold_currency ?? undefined, thresholdUnit: a.threshold_unit ?? undefined,
      thresholdPerKgLocal: a.threshold_per_kg_local ? fmt(a.threshold_per_kg_local, 4) : null, pctWindowDays: a.pct_window_days, channels: a.channels,
      cooldownHours: a.cooldown_hours, active: a.active, lastTriggeredAt: a.last_triggered_at?.toISOString() ?? null, triggerCount: a.trigger_count,
      createdAt: a.created_at.toISOString(), updatedAt: a.updated_at.toISOString(),
    };
  }

  private async get(user: AuthUser, id: string) {
    const a = await this.sql.one<AlertRow>(`SELECT * FROM alerts WHERE id = $1 AND user_id = $2`, [id, user.id]);
    if (!a) throw AppError.notFound("alert");
    return a;
  }

  /** Threshold (currency/unit) → per-kg local currency, at today's FX. */
  private async normalise(threshold: string, currency: string, unit: string, commodityId: string, country: string, localCurrency: string) {
    const kg = await this.money.kgPerUnit(commodityId, unit, country);
    let perKg = D(threshold).div(kg);
    if (currency !== localCurrency) {
      const toUsd = currency === "USD" ? "1" : (await this.money.rate(currency, "USD"))?.rate;
      const localToUsd = (await this.money.rate(localCurrency, "USD"))?.rate;
      if (!toUsd || !localToUsd) throw AppError.unprocessable("currency_unsupported", `No FX rate for ${currency}`);
      perKg = perKg.mul(toUsd).div(localToUsd);
    }
    return perKg.toDecimalPlaces(6).toString();
  }

  async list(user: AuthUser, active?: boolean) {
    const rows = await this.sql.many<AlertRow>(`SELECT * FROM alerts WHERE user_id = $1 AND ($2::boolean IS NULL OR active = $2) ORDER BY created_at DESC`, [user.id, active ?? null]);
    return rows.map((a) => this.dto(a));
  }

  async create(user: AuthUser, d: AlertCreateDto, client: ClientMeta) {
    const n = await this.sql.one<{ n: number }>(`SELECT count(*)::int AS n FROM alerts WHERE user_id = $1`, [user.id]);
    if ((n?.n ?? 0) >= MAX_ALERTS_PER_USER) throw AppError.unprocessable("alert_limit", `You can have up to ${MAX_ALERTS_PER_USER} alerts`);
    if (d.marketId && d.regionId) throw AppError.unprocessable("alert_scope", "Choose a market or a region, not both");
    if (!(await this.sql.one(`SELECT 1 FROM commodities WHERE id = $1`, [d.commodityId]))) throw AppError.unprocessable("commodity_unknown", "Commodity not found");

    let country = user.country;
    if (d.marketId) {
      const m = await this.sql.one<{ country_iso2: string }>(`SELECT country_iso2 FROM markets WHERE id = $1`, [d.marketId]);
      if (!m) throw AppError.unprocessable("market_unknown", "Market not found");
      country = m.country_iso2;
    } else if (d.regionId) {
      const r = await this.sql.one<{ country_iso2: string }>(`SELECT country_iso2 FROM regions WHERE id = $1`, [d.regionId]);
      if (!r) throw AppError.unprocessable("region_unknown", "Region not found");
      country = r.country_iso2;
    }
    const ctx = await this.money.resolveDisplay({ currency: d.thresholdCurrency, unit: d.thresholdUnit }, user, country);
    let perKg: string | null = null;
    if (d.condition === "pct_change") {
      if (D(d.threshold).abs().gt(500) || D(d.threshold).isZero()) throw AppError.unprocessable("threshold_invalid", "Percentage threshold must be non-zero and within ±500");
    } else {
      if (D(d.threshold).lte(0)) throw AppError.unprocessable("threshold_invalid", "Threshold must be positive");
      perKg = await this.normalise(d.threshold, ctx.currency, ctx.unit, d.commodityId, country, ctx.localCurrency);
    }
    const row = await this.sql.one<AlertRow>(
      `INSERT INTO alerts (user_id, commodity_id, market_id, region_id, country_iso2, price_type, condition, threshold, threshold_currency, threshold_unit,
         threshold_per_kg_local, pct_window_days, channels, cooldown_hours, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [user.id, d.commodityId, d.marketId ?? null, d.regionId ?? null, country, d.priceType, d.condition, d.threshold,
        d.condition === "pct_change" ? null : ctx.currency, d.condition === "pct_change" ? null : ctx.unit, perKg, d.pctWindowDays, d.channels, d.cooldownHours, d.active]);
    await this.audit.record({ actorId: user.id, action: "alert.created", entity: "alert", entityId: row!.id }, client);
    return this.dto(row!);
  }

  async update(user: AuthUser, id: string, d: AlertUpdateDto) {
    const a = await this.get(user, id);
    const condition = d.condition ?? a.condition;
    const threshold = d.threshold ?? a.threshold;
    let perKg = a.threshold_per_kg_local;
    let currency = a.threshold_currency, unit = a.threshold_unit;
    if (condition === "pct_change") { perKg = null; currency = null; unit = null; }
    else if (d.threshold || d.condition) {
      const ctx = await this.money.resolveDisplay({ currency: currency ?? undefined, unit: unit ?? undefined }, user, a.country_iso2);
      if (D(threshold).lte(0)) throw AppError.unprocessable("threshold_invalid", "Threshold must be positive");
      currency = ctx.currency; unit = ctx.unit;
      perKg = await this.normalise(threshold, ctx.currency, ctx.unit, a.commodity_id, a.country_iso2, ctx.localCurrency);
    }
    const row = await this.sql.one<AlertRow>(
      `UPDATE alerts SET condition = $3, threshold = $4, threshold_per_kg_local = $5, threshold_currency = $6, threshold_unit = $7,
         pct_window_days = coalesce($8, pct_window_days), channels = coalesce($9, channels), cooldown_hours = coalesce($10, cooldown_hours),
         active = coalesce($11, active),
         last_state = CASE WHEN $3 <> condition OR $4::numeric <> threshold THEN NULL ELSE last_state END
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, user.id, condition, threshold, perKg, currency, unit, d.pctWindowDays ?? null, d.channels ?? null, d.cooldownHours ?? null, d.active ?? null]);
    return this.dto(row!);
  }

  async remove(user: AuthUser, id: string) {
    if (!(await this.sql.exec(`DELETE FROM alerts WHERE id = $1 AND user_id = $2`, [id, user.id]))) throw AppError.notFound("alert");
  }

  async history(user: AuthUser, q: HistoryQuery) {
    const c = cursor.decode<{ t: string; id: string }>(q.cursor);
    const rows = await this.sql.many<{ id: string; alert_id: string; commodity_id: string; market_id: string | null; triggered_at: Date; condition: string; observed_value: string; threshold: string; change_pct: number | null; direction: string; delivered_channels: string[]; suppressed_reason: string | null }>(
      `SELECT id, alert_id, commodity_id, market_id, triggered_at, condition, observed_value, threshold, change_pct, direction, delivered_channels, suppressed_reason
       FROM alert_events WHERE user_id = $1 AND ($2::uuid IS NULL OR alert_id = $2)
         AND ($3::timestamptz IS NULL OR (triggered_at, id) < ($3, $4::uuid))
       ORDER BY triggered_at DESC, id DESC LIMIT $5`, [user.id, q.alert_id ?? null, c?.t ?? null, c?.id ?? null, q.limit + 1]);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      data: page.map((e) => ({
        id: e.id, alertId: e.alert_id, commodityId: e.commodity_id, marketId: e.market_id, triggeredAt: e.triggered_at.toISOString(), condition: e.condition,
        observedValue: fmt(e.observed_value, 4), threshold: fmt(e.threshold, 4), changePct: e.change_pct, direction: e.direction,
        deliveredChannels: e.delivered_channels, suppressedReason: e.suppressed_reason,
      })),
      nextCursor: rows.length > q.limit && last ? cursor.encode({ t: last.triggered_at.toISOString(), id: last.id }) : null,
    };
  }

  async insights(user: AuthUser) {
    const r = await this.sql.one<{ active: number; total: number; d30: number; above: number; below: number }>(
      `SELECT (SELECT count(*) FROM alerts WHERE user_id = $1 AND active)::int AS active,
              count(*)::int AS total,
              count(*) FILTER (WHERE triggered_at >= now() - interval '30 days')::int AS d30,
              count(*) FILTER (WHERE direction = 'above')::int AS above,
              count(*) FILTER (WHERE direction = 'below')::int AS below
       FROM alert_events WHERE user_id = $1`, [user.id]);
    const trend = await this.sql.many<{ date: Date; count: number }>(
      `SELECT d::date AS date, count(e.id)::int AS count
       FROM generate_series((now() - interval '29 days')::date, now()::date, interval '1 day') d
       LEFT JOIN alert_events e ON e.user_id = $1 AND e.triggered_at::date = d::date
       GROUP BY d ORDER BY d`, [user.id]);
    const top = await this.sql.one<{ alert_id: string; commodity_id: string; name: Record<string, string>; count: number }>(
      `SELECT e.alert_id, e.commodity_id, c.name, count(*)::int AS count FROM alert_events e JOIN commodities c ON c.id = e.commodity_id
       WHERE e.user_id = $1 GROUP BY e.alert_id, e.commodity_id, c.name ORDER BY count DESC LIMIT 1`, [user.id]);
    return {
      activeAlerts: r?.active ?? 0, triggeredTotal: r?.total ?? 0, triggered30d: r?.d30 ?? 0, aboveCount: r?.above ?? 0, belowCount: r?.below ?? 0,
      trend30d: trend.map((t) => ({ date: t.date.toISOString().slice(0, 10), count: t.count })),
      mostFrequent: top ? { alertId: top.alert_id, commodityId: top.commodity_id, commodityName: top.name, count: top.count } : null,
    };
  }

  one(user: AuthUser, id: string) { return this.get(user, id).then((a) => this.dto(a)); }
}

@ApiTags("alerts")
@ApiBearerAuth()
@Controller("v1/alerts")
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get() @ApiOperation({ operationId: "alerts_list" })
  list(@CurrentUser() u: AuthUser, @Query() q: AlertsListQuery) { return this.alerts.list(u, q.active); }

  @Post() @ApiOperation({ operationId: "alerts_create" })
  create(@CurrentUser() u: AuthUser, @Body() d: AlertCreateDto, @Client() c: ClientMeta) { return this.alerts.create(u, d, c); }

  @Get("history") @ApiOperation({ operationId: "alerts_history" })
  history(@CurrentUser() u: AuthUser, @Query() q: HistoryQuery) { return this.alerts.history(u, q); }

  @Get("insights") @ApiOperation({ operationId: "alerts_insights" })
  insights(@CurrentUser() u: AuthUser) { return this.alerts.insights(u); }

  @Get(":id") @ApiOperation({ operationId: "alerts_get" })
  get(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { return this.alerts.one(u, id); }

  @Patch(":id") @ApiOperation({ operationId: "alerts_update" })
  update(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() d: AlertUpdateDto) { return this.alerts.update(u, id, d); }

  @Delete(":id") @HttpCode(204) @ApiOperation({ operationId: "alerts_delete" })
  async remove(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { await this.alerts.remove(u, id); }
}

@Module({ controllers: [AlertsController], providers: [AlertsService] })
export class AlertsModule {}
