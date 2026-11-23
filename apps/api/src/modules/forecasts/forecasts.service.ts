import { Injectable } from "@nestjs/common";
import type { AuthUser } from "../../common/auth/auth.common";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { I18nService } from "../../common/i18n/i18n.service";
import { pctChange } from "../../common/money/money.math";
import { DisplayHints, MoneyService } from "../../common/money/money.service";
import { PricesService } from "../prices/prices.service";

export interface ShapFeature { feature: string; i18nKey: string; value: number | string | null; contribution: number; sharePct: number; direction: "up" | "down" }

interface RunRow {
  id: string; commodity_id: string; market_id: string | null; region_id: string | null; country_iso2: string; price_type: string;
  model_version: string; generated_at: Date; as_of_date: Date; latest_actual_kg_local: string | null;
}
interface PointRow { horizon_months: number; target_date: Date; p10: string; p50: string; p90: string; backtest_mape: number | null; interval_width_pct: number; confidence: string }

@Injectable()
export class ForecastsService {
  constructor(private readonly sql: Sql, private readonly money: MoneyService, private readonly prices: PricesService, private readonly i18n: I18nService) {}

  async latestRun(commodityId: string, marketId: string | undefined, regionId: string | undefined, priceType: string): Promise<RunRow | undefined> {
    return this.sql.one<RunRow>(
      `SELECT f.id, f.commodity_id, f.market_id, f.region_id, f.country_iso2, f.price_type, mv.version AS model_version, f.generated_at, f.as_of_date, f.latest_actual_kg_local
       FROM forecast_runs f JOIN model_versions mv ON mv.id = f.model_version_id
       WHERE f.is_latest AND f.commodity_id = $1 AND f.price_type = $4
         AND f.market_id IS NOT DISTINCT FROM $2::uuid AND f.region_id IS NOT DISTINCT FROM $3::uuid`,
      [commodityId, marketId ?? null, marketId ? null : regionId ?? null, priceType]);
  }

  async points(forecastId: string) {
    return this.sql.many<PointRow>(
      `SELECT horizon_months, target_date, p10::text, p50::text, p90::text, backtest_mape, interval_width_pct, confidence
       FROM forecast_points WHERE forecast_id = $1 ORDER BY horizon_months`, [forecastId]);
  }

  async get(q: { commodity_id: string; market_id?: string; region_id?: string; price_type: string }, hints: DisplayHints, user: AuthUser | null) {
    if (!q.market_id && !q.region_id) throw AppError.unprocessable("series_required", "Provide market_id or region_id");
    const run = await this.latestRun(q.commodity_id, q.market_id, q.region_id, q.price_type);
    if (!run) throw AppError.notFound("forecast", "No forecast is available for this series yet");
    const ctx = await this.money.resolveDisplay(hints, user, run.country_iso2);
    const conv = await this.prices.converter(q.commodity_id, ctx);
    const pts = await this.points(run.id);
    // Forecasts are in local currency per kg; convert at today's FX (no historical USD for future dates).
    return {
      id: run.id, commodityId: run.commodity_id, marketId: run.market_id, regionId: run.region_id, priceType: run.price_type,
      modelVersion: run.model_version, generatedAt: run.generated_at.toISOString(), asOfDate: run.as_of_date.toISOString().slice(0, 10),
      currency: conv.currency, unit: conv.unit, latestActual: conv.conv(run.latest_actual_kg_local),
      horizons: pts.map((p) => ({
        horizonMonths: p.horizon_months, targetDate: p.target_date.toISOString().slice(0, 10),
        p10: conv.conv(p.p10)!, p50: conv.conv(p.p50)!, p90: conv.conv(p.p90)!,
        changePctVsLatest: pctChange(p.p50, run.latest_actual_kg_local),
        backtestMape: p.backtest_mape, intervalWidthPct: Math.round(p.interval_width_pct * 100) / 100, confidence: p.confidence,
      })),
    };
  }

  async explanation(id: string, horizon: number, locale: string) {
    const row = await this.sql.one<{ base_value: number; features: ShapFeature[]; insight_key: string; insight_params: Record<string, string | number>; commodity_name: Record<string, string> }>(
      `SELECT e.base_value, e.features, e.insight_key, e.insight_params, c.name AS commodity_name
       FROM forecast_explanations e JOIN forecast_runs f ON f.id = e.forecast_id JOIN commodities c ON c.id = f.commodity_id
       WHERE e.forecast_id = $1 AND e.horizon_months = $2`, [id, horizon]);
    if (!row) throw AppError.notFound("explanation");
    const features = row.features.slice(0, 7);
    const drivers = features.filter((f) => !f.feature.startsWith("month_")).slice(0, 2).map((f) => this.i18n.t(f.i18nKey, locale).toLowerCase());
    const params = {
      ...row.insight_params, commodity: this.i18n.pick(row.commodity_name, locale),
      driver1: drivers[0] ?? this.i18n.t("forecast.feature.month_sin", locale).toLowerCase(),
      driver2: drivers[1] ?? this.i18n.t("forecast.feature.lag_1m", locale).toLowerCase(),
    };
    return {
      forecastId: id, horizonMonths: horizon, baseValue: row.base_value, features,
      insight: { i18nKey: row.insight_key, params, text: this.i18n.t(row.insight_key, locale, params) },
    };
  }
}
