import { createParamDecorator, ExecutionContext, Global, Injectable, Module } from "@nestjs/common";
import type { Request } from "express";
import { Sql } from "../db/database.module";
import { AppError } from "../http/problem";
import type { AuthUser } from "../auth/auth.common";
import { convertForDisplay, D, fmt } from "./money.math";

export interface DisplayHints { currency?: string; unit?: string; locale?: string }
export interface DisplayContext { currency: string; unit: string; locale: string; localCurrency: string; country: string }

export interface Money { amount: string; currency: string; unit: string }
export interface PriceValue { observed: Money; display: Money; perKgLocal: string; perKgUsd: string; fxRateId: string | null }

/** Reads ?currency= / ?unit= first, then X-Currency / X-Unit, and Accept-Language. */
export const Display = createParamDecorator((_: unknown, ctx: ExecutionContext): DisplayHints => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const q = req.query as Record<string, string | undefined>;
  const currency = (q.currency ?? req.header("x-currency"))?.toUpperCase();
  const unit = q.unit ?? req.header("x-unit") ?? req.header("x-units");
  const locale = req.header("accept-language")?.split(",")[0]?.split(";")[0]?.trim();
  return {
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : undefined,
    unit: unit && /^[\w.-]{1,32}$/.test(unit) ? unit : undefined,
    locale: locale && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(locale) ? locale : undefined,
  };
});

interface CountryRow { iso2: string; currency: string; default_unit: string; default_locale: string }

@Injectable()
export class MoneyService {
  private unitCache?: { at: number; generic: Map<string, string | null>; specific: Map<string, string> };
  private countryCache = new Map<string, { at: number; row: CountryRow }>();
  private fxCache = new Map<string, { at: number; rate: string | null }>();
  private static TTL = 10 * 60_000;

  constructor(private readonly sql: Sql) {}

  async country(iso2: string): Promise<CountryRow> {
    const key = iso2.toUpperCase();
    const hit = this.countryCache.get(key);
    if (hit && Date.now() - hit.at < MoneyService.TTL) return hit.row;
    const row = await this.sql.one<CountryRow>(`SELECT iso2, currency, default_unit, default_locale FROM countries WHERE iso2 = $1`, [key]);
    if (!row) throw AppError.notFound("country", key);
    this.countryCache.set(key, { at: Date.now(), row });
    return row;
  }

  /** Query/header → user preference → country pack default. */
  async resolveDisplay(hints: DisplayHints, user: AuthUser | null, countryHint?: string): Promise<DisplayContext> {
    let prefs: { currency: string | null; unit: string | null; locale: string | null } | undefined;
    if (user && (!hints.currency || !hints.unit || !hints.locale)) {
      prefs = await this.sql.one(`SELECT currency, unit, locale FROM user_preferences WHERE user_id = $1`, [user.id]);
    }
    const c = await this.country((countryHint ?? user?.country ?? "GH").toUpperCase());
    return {
      country: c.iso2,
      localCurrency: c.currency,
      currency: hints.currency ?? prefs?.currency ?? c.currency,
      unit: hints.unit ?? prefs?.unit ?? c.default_unit,
      locale: hints.locale ?? prefs?.locale ?? c.default_locale,
    };
  }

  private async loadUnits() {
    if (this.unitCache && Date.now() - this.unitCache.at < MoneyService.TTL) return this.unitCache;
    const generic = new Map<string, string | null>();
    for (const r of await this.sql.many<{ code: string; kg_factor: string | null }>(`SELECT code, kg_factor FROM units`)) generic.set(r.code, r.kg_factor);
    const specific = new Map<string, string>();
    for (const r of await this.sql.many<{ commodity_id: string; unit_code: string; country_iso2: string | null; kg_factor: string }>(
      `SELECT commodity_id, unit_code, country_iso2, kg_factor FROM commodity_unit_conversions`,
    )) specific.set(`${r.commodity_id}|${r.unit_code}|${r.country_iso2 ?? "*"}`, r.kg_factor);
    this.unitCache = { at: Date.now(), generic, specific };
    return this.unitCache;
  }

  /** kg per 1 `unit` of `commodity` in `country`: country-specific → commodity generic → unit generic. */
  async kgPerUnit(commodityId: string, unit: string, country: string): Promise<string> {
    const u = await this.loadUnits();
    const f = u.specific.get(`${commodityId}|${unit}|${country}`) ?? u.specific.get(`${commodityId}|${unit}|*`) ?? u.generic.get(unit);
    if (f == null) {
      if (!u.generic.has(unit)) throw AppError.unprocessable("unit_unknown", `Unknown unit '${unit}'`);
      throw AppError.unprocessable("unit_not_convertible", `Unit '${unit}' has no kg conversion for this commodity`);
    }
    return f;
  }

  /** Units of `quote` per 1 `base`, latest on or before `date`. */
  async rate(base: string, quote: string, date = new Date()): Promise<{ id: string; rate: string } | null> {
    if (base === quote) return null;
    const row = await this.sql.one<{ id: string; rate: string }>(
      `SELECT id, rate FROM fx_rates WHERE base = $1 AND quote = $2 AND rate_date <= $3::date ORDER BY rate_date DESC LIMIT 1`,
      [base, quote, date.toISOString().slice(0, 10)],
    );
    return row ?? null;
  }

  /** USD → target (cached). Uses a direct USD→X rate, or inverts X→USD. */
  async usdTo(target: string): Promise<string | null> {
    if (target === "USD") return "1";
    const hit = this.fxCache.get(target);
    if (hit && Date.now() - hit.at < MoneyService.TTL) return hit.rate;
    const direct = await this.rate("USD", target);
    const inv = direct ? null : await this.rate(target, "USD");
    const rate = direct?.rate ?? (inv ? D(1).div(inv.rate).toString() : null);
    this.fxCache.set(target, { at: Date.now(), rate });
    return rate;
  }

  /** Converts a stored per-kg pair into the display currency/unit. */
  async display(perKgLocal: string, perKgUsd: string, commodityId: string, ctx: DisplayContext): Promise<string> {
    const [kg, usdTo] = await Promise.all([
      this.kgPerUnit(commodityId, ctx.unit, ctx.country).catch(() => this.kgPerUnit(commodityId, "kg", ctx.country)),
      ctx.currency === ctx.localCurrency ? Promise.resolve(null) : this.usdTo(ctx.currency),
    ]);
    if (ctx.currency !== ctx.localCurrency && ctx.currency !== "USD" && usdTo == null)
      throw AppError.unprocessable("currency_unsupported", `No FX rate available for ${ctx.currency}`);
    return fmt(convertForDisplay({
      perKgLocal, perKgUsd, localCurrency: ctx.localCurrency, targetCurrency: ctx.currency, usdToTarget: usdTo, targetKgPerUnit: kg,
    }));
  }

  /** Per-kg local value only (aggregates) → display; USD derived via latest FX when needed. */
  async displayFromLocal(perKgLocal: string | null, commodityId: string, ctx: DisplayContext): Promise<string | null> {
    if (perKgLocal == null) return null;
    if (ctx.currency === ctx.localCurrency) {
      const kg = await this.kgPerUnit(commodityId, ctx.unit, ctx.country).catch(() => "1");
      return fmt(D(perKgLocal).mul(kg));
    }
    const localToUsd = await this.rate(ctx.localCurrency, "USD");
    if (!localToUsd) throw AppError.unprocessable("currency_unsupported", `No FX rate for ${ctx.localCurrency}→USD`);
    return this.display(perKgLocal, D(perKgLocal).mul(localToUsd.rate).toString(), commodityId, ctx);
  }

  /**
   * Multiplier from per-kg LOCAL to the display currency/unit. Conversion is linear, so lists
   * compute this once and apply it to every row (one FX lookup per request, not per row).
   */
  async factorFromLocal(commodityId: string, ctx: DisplayContext): Promise<{ factor: string; unit: string }> {
    const unit = await this.kgPerUnit(commodityId, ctx.unit, ctx.country).then(() => ctx.unit).catch(() => "kg");
    const kg = await this.kgPerUnit(commodityId, unit, ctx.country).catch(() => "1");
    if (ctx.currency === ctx.localCurrency) return { factor: D(kg).toString(), unit };
    const localToUsd = await this.rate(ctx.localCurrency, "USD");
    const usdTo = await this.usdTo(ctx.currency);
    if (!localToUsd || usdTo == null) throw AppError.unprocessable("currency_unsupported", `No FX rate for ${ctx.localCurrency}→${ctx.currency}`);
    return { factor: D(localToUsd.rate).mul(usdTo).mul(kg).toString(), unit };
  }

  apply(perKgLocal: string | number | null | undefined, factor: string, dp = 2): string | null {
    if (perKgLocal == null) return null;
    return fmt(D(perKgLocal).mul(factor), dp);
  }

  async priceValue(
    row: { amount: string; currency: string; unit_code: string; price_per_kg_local: string; price_per_kg_usd: string; fx_rate_id: string | null; commodity_id: string },
    ctx: DisplayContext,
  ): Promise<PriceValue> {
    const effectiveUnit = await this.kgPerUnit(row.commodity_id, ctx.unit, ctx.country).then(() => ctx.unit).catch(() => "kg");
    return {
      observed: { amount: fmt(row.amount), currency: row.currency, unit: row.unit_code },
      display: { amount: await this.display(row.price_per_kg_local, row.price_per_kg_usd, row.commodity_id, ctx), currency: ctx.currency, unit: effectiveUnit },
      perKgLocal: fmt(row.price_per_kg_local, 4),
      perKgUsd: fmt(row.price_per_kg_usd, 4),
      fxRateId: row.fx_rate_id,
    };
  }
}

@Global()
@Module({ providers: [MoneyService], exports: [MoneyService] })
export class MoneyModule {}
