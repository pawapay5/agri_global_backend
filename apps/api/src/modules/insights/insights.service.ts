import { Inject, Injectable, Logger } from "@nestjs/common";
import { APP_CONFIG, AppConfig } from "../../config/config";
import type { AuthUser } from "../../common/auth/auth.common";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { I18nService } from "../../common/i18n/i18n.service";
import { D, fmt, pctChange } from "../../common/money/money.math";
import { DisplayHints, MoneyService } from "../../common/money/money.service";
import { Cache } from "../../common/redis/redis.module";
import { ForecastsService } from "../forecasts/forecasts.service";
import { GeoRepository } from "../geo/geo.repository";
import { GeoService } from "../geo/geo.service";
import { PricesService } from "../prices/prices.service";
import { Condition, DailyWeather, evalCondition, recommend, seasonalProfile, weatherMetrics } from "./insights.logic";

@Injectable()
export class InsightsService {
  private readonly log = new Logger(InsightsService.name);
  constructor(
    private readonly sql: Sql,
    private readonly money: MoneyService,
    private readonly prices: PricesService,
    private readonly forecasts: ForecastsService,
    private readonly geo: GeoService,
    private readonly geoRepo: GeoRepository,
    private readonly i18n: I18nService,
    private readonly cache: Cache,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  // ── seasonal ──
  async seasonal(q: { commodity_id: string; country?: string; region_id?: string; market_id?: string; price_type: string }, hints: DisplayHints, user: AuthUser | null) {
    let country = q.country;
    if (q.market_id) country = (await this.geoRepo.market(q.market_id))?.country_iso2 ?? country;
    const ctx = await this.money.resolveDisplay(hints, user, country);
    const conv = await this.prices.converter(q.commodity_id, ctx);
    const rows = await this.sql.many<{ year: number; month: number; avg_local: string; avg_usd: string }>(
      `SELECT extract(year FROM bucket)::int AS year, extract(month FROM bucket)::int AS month,
              (sum(sum_kg_local) / sum(n))::text AS avg_local, (sum(sum_kg_usd) / sum(n))::text AS avg_usd
       FROM price_weekly
       WHERE commodity_id = $1 AND price_type = $2 AND country_iso2 = $3
         AND bucket >= date_trunc('year', now()) - interval '3 years'
         AND ($4::uuid IS NULL OR market_id = $4)
         AND ($5::uuid IS NULL OR region_id = $5 OR region_ancestor_at_level(region_id, (SELECT level FROM regions WHERE id = $5)) = $5)
       GROUP BY 1, 2`, [q.commodity_id, q.price_type, ctx.country, q.market_id ?? null, q.region_id ?? null]);
    const p = seasonalProfile(rows.map((r) => ({ year: r.year, month: r.month, avg: Number(conv.conv(r.avg_local, r.avg_usd)) })));
    const name = await this.commodityName(q.commodity_id, ctx.locale);
    const months = (ms: number[]) => this.i18n.joinList(ms.map((m) => this.i18n.monthName(m, ctx.locale)), ctx.locale);
    const s = (v: number | null) => (v == null ? null : v.toFixed(2));
    return {
      commodityId: q.commodity_id, currency: conv.currency, unit: conv.unit,
      years: p.years.map((y) => ({ year: y.year, months: y.months.map(s) })), monthlyAverage: p.monthlyAverage.map(s),
      peakMonths: p.peakMonths, lowMonths: p.lowMonths, avgMonthlyChangePct: p.avgMonthlyChangePct,
      insight: p.peakMonths.length
        ? this.i18n.t("seasonal.insight", ctx.locale, { commodity: name, peak: months(p.peakMonths), low: months(p.lowMonths) })
        : this.i18n.t("seasonal.insufficient", ctx.locale),
    };
  }

  // ── alternative markets ──
  async alternativeMarkets(q: { commodity_id: string; market_id: string; radius_km: number; transport_cost_per_kg_km?: number; price_type: string }, hints: DisplayHints, user: AuthUser | null) {
    const ref = await this.geoRepo.market(q.market_id);
    if (!ref) throw AppError.notFound("market");
    const [refLatest] = await this.geo.latestFor(q.commodity_id, q.price_type, [q.market_id]);
    if (!refLatest) return [];
    const nearby = (await this.geoRepo.marketsWithin(ref.lat, ref.lng, q.radius_km, 50)).filter((m) => m.id !== q.market_id);
    if (!nearby.length) return [];
    const latest = await this.geo.latestFor(q.commodity_id, q.price_type, nearby.map((m) => m.id));
    const ctx = await this.money.resolveDisplay(hints, user, ref.country_iso2);
    const recentCutoff = Date.now() - 21 * 86_400_000; // stale prices don't make good arbitrage signals
    const refPrice = D(refLatest.price_per_kg_local);

    const out = await Promise.all(latest.filter((l) => l.observed_at.getTime() >= recentCutoff).map(async (l) => {
      const m = nearby.find((n) => n.id === l.market_id)!;
      const gross = pctChange(l.price_per_kg_local, refLatest.price_per_kg_local)!;
      const net = q.transport_cost_per_kg_km != null
        ? D(l.price_per_kg_local).minus(D(q.transport_cost_per_kg_km).mul(m.distance_km)).minus(refPrice).div(refPrice).mul(100).toDecimalPlaces(2).toNumber()
        : null;
      return {
        market: this.geoRepo.toMarket(m), distanceKm: Math.round(m.distance_km * 10) / 10,
        latest: { value: await this.money.priceValue(l, ctx), observedAt: l.observed_at.toISOString(), priceType: l.price_type },
        grossMarginPct: gross, netMarginPct: net,
      };
    }));
    return out.sort((a, b) => (b.netMarginPct ?? b.grossMarginPct) - (a.netMarginPct ?? a.grossMarginPct));
  }

  // ── recommendations (rules + model output) ──
  async recommendations(q: { commodity_id: string; market_id: string; price_type: string }, hints: DisplayHints, user: AuthUser) {
    const ctx = await this.money.resolveDisplay(hints, user);
    const [commodity, run] = await Promise.all([
      this.sql.one<{ perishability: "low" | "medium" | "high"; name: Record<string, string> }>(`SELECT perishability, name FROM commodities WHERE id = $1`, [q.commodity_id]),
      this.forecasts.latestRun(q.commodity_id, q.market_id, undefined, q.price_type),
    ]);
    if (!commodity) throw AppError.notFound("commodity");
    const points = run ? await this.forecasts.points(run.id) : [];
    const horizons = points.map((p) => ({ months: p.horizon_months, changePct: pctChange(p.p50, run?.latest_actual_kg_local), confidence: p.confidence as "high" | "medium" | "low" }));
    const seasonal = await this.seasonal({ commodity_id: q.commodity_id, market_id: q.market_id, price_type: q.price_type }, hints, user);
    const alts = await this.alternativeMarkets({ commodity_id: q.commodity_id, market_id: q.market_id, radius_km: 200, price_type: q.price_type }, hints, user);

    const recs = recommend({
      horizons, perishability: commodity.perishability, peakMonths: seasonal.peakMonths,
      alternatives: alts.map((a) => ({ marketId: a.market.id, name: this.i18n.pick(a.market.name, ctx.locale), distanceKm: a.distanceKm, marginPct: a.netMarginPct ?? a.grossMarginPct })),
    });
    const name = this.i18n.pick(commodity.name, ctx.locale);
    const peak = this.i18n.joinList(seasonal.peakMonths.map((m) => this.i18n.monthName(m, ctx.locale)), ctx.locale);
    return {
      commodityId: q.commodity_id, marketId: q.market_id, generatedAt: new Date().toISOString(),
      recommendations: recs.map((r) => {
        const params = { ...r.params, commodity: name, peak };
        return {
          kind: r.kind, title: this.i18n.t(r.titleKey, ctx.locale, params), rationale: this.i18n.t(r.i18nKey, ctx.locale, params), i18nKey: r.i18nKey, params,
          confidence: r.confidence, expectedChangePct: r.expectedChangePct, marginPct: r.marginPct, marketId: r.marketId, basis: r.basis,
        };
      }),
    };
  }

  // ── planting suggestions from the crop calendar ──
  async planting(q: { region_id: string; month?: number }, user: AuthUser) {
    const region = await this.sql.one<{ country_iso2: string; name: Record<string, string> }>(`SELECT country_iso2, name FROM regions WHERE id = $1`, [q.region_id]);
    if (!region) throw AppError.notFound("region");
    const ctx = await this.money.resolveDisplay({}, user, region.country_iso2);
    const month = q.month ?? new Date().getUTCMonth() + 1;
    const rows = await this.sql.many<{ commodity_id: string; name: Record<string, string>; planting_months: number[]; harvest_months: number[]; region_specific: boolean }>(
      // A region-specific calendar overrides the national one.
      `SELECT DISTINCT ON (cc.commodity_id) cc.commodity_id, c.name, cc.planting_months, cc.harvest_months, cc.region_id IS NOT NULL AS region_specific
       FROM crop_calendars cc JOIN commodities c ON c.id = cc.commodity_id
       WHERE cc.country_iso2 = $1 AND (cc.region_id IS NULL OR cc.region_id = $2 OR cc.region_id = region_ancestor_at_level($2, 1))
       ORDER BY cc.commodity_id, (cc.region_id IS NULL)`, [region.country_iso2, q.region_id]);
    const candidates = rows.filter((r) => r.planting_months.includes(month));
    if (!candidates.length) return [];

    // Harvest-time price premium vs. the yearly mean (national, wholesale, last 3 years).
    const seasonal = await this.sql.many<{ commodity_id: string; month: number; idx: number }>(
      `WITH m AS (
         SELECT commodity_id, extract(year FROM bucket)::int AS y, extract(month FROM bucket)::int AS month, sum(sum_kg_local) / sum(n) AS avg
         FROM price_weekly WHERE country_iso2 = $1 AND price_type = 'wholesale' AND commodity_id = ANY($2::uuid[]) AND bucket >= now() - interval '3 years'
         GROUP BY 1, 2, 3
       ), y AS (SELECT commodity_id, y, avg(avg) AS ymean FROM m GROUP BY 1, 2)
       SELECT m.commodity_id, m.month, avg(m.avg / y.ymean)::float8 AS idx FROM m JOIN y USING (commodity_id, y) GROUP BY 1, 2`,
      [region.country_iso2, candidates.map((c) => c.commodity_id)]);
    const regionName = this.i18n.pick(region.name, ctx.locale);

    return candidates.map((c) => {
      const idx = seasonal.filter((s) => s.commodity_id === c.commodity_id && c.harvest_months.includes(s.month)).map((s) => s.idx);
      const premium = idx.length ? Math.round((idx.reduce((a, b) => a + b, 0) / idx.length - 1) * 10000) / 100 : null;
      const reasons = [
        this.i18n.t("rec.plant.rationale", ctx.locale, {
          region: regionName, harvest: this.i18n.joinList(c.harvest_months.map((m) => this.i18n.monthName(m, ctx.locale)), ctx.locale), pct: premium?.toFixed(0) ?? "0",
        }),
      ];
      // Score: in-window (base 50) + harvest premium + bonus for region-specific calendars.
      const score = Math.round((50 + (premium ?? 0) * 2 + (c.region_specific ? 10 : 0)) * 10) / 10;
      return { commodityId: c.commodity_id, commodityName: c.name, plantingWindow: c.planting_months, harvestMonths: c.harvest_months, expectedHarvestPriceChangePct: premium, score, reasons };
    }).sort((a, b) => b.score - a.score);
  }

  // ── weather + advice (Open-Meteo) ──
  async weather(q: { lat?: number; lng?: number; location_id?: string; commodity_ids?: string[] }, user: AuthUser) {
    let lat = q.lat, lng = q.lng;
    if (q.location_id) {
      const loc = await this.sql.one<{ lat: number; lng: number }>(
        `SELECT ST_Y(point::geometry) AS lat, ST_X(point::geometry) AS lng FROM saved_locations WHERE id = $1 AND user_id = $2`, [q.location_id, user.id]);
      if (!loc) throw AppError.notFound("location");
      ({ lat, lng } = loc);
    }
    if (lat == null || lng == null) throw AppError.unprocessable("location_required", "Provide lat/lng or location_id");
    const ctx = await this.money.resolveDisplay({}, user);
    const key = `wx:${lat.toFixed(2)}:${lng.toFixed(2)}`; // ~1 km grid
    const { fetchedAt, days } = await this.cache.wrap(key, 3600, () => this.fetchOpenMeteo(lat!, lng!));
    const metrics = weatherMetrics(days);

    const month = new Date().getUTCMonth() + 1;
    const rules = await this.sql.many<{ code: string; severity: string; condition: Condition; months: number[]; i18n_key: string; commodity_id: string | null }>(
      `SELECT code, severity, condition, months, i18n_key, commodity_id FROM agro_advice_rules
       WHERE active AND (country_iso2 IS NULL OR country_iso2 = $1)
         AND (commodity_id IS NULL OR commodity_id = ANY($2::uuid[]))`, [user.country, q.commodity_ids ?? []]);
    const from = days[0]?.date ?? new Date().toISOString().slice(0, 10), to = days[days.length - 1]?.date ?? from;
    const params = { mm: metrics.precip_max_3d!, days: metrics.dry_days_ahead!, temp: metrics.temp_max! };
    const advice = rules
      .filter((r) => (!r.months.length || r.months.includes(month)) && evalCondition(r.condition, metrics))
      .map((r) => ({ code: r.code, severity: r.severity, i18nKey: r.i18n_key, text: this.i18n.t(r.i18n_key, ctx.locale, params), commodityId: r.commodity_id, validFrom: from, validTo: to }))
      .sort((a, b) => ["critical", "warning", "info"].indexOf(a.severity) - ["critical", "warning", "info"].indexOf(b.severity));

    return {
      location: { lat, lng }, source: "open-meteo", fetchedAt,
      days: days.map((d) => ({ date: d.date, tempMinC: d.tMin, tempMaxC: d.tMax, precipitationMm: d.precip, precipitationProbabilityPct: d.precipProb, humidityPct: d.humidity, windMaxKmh: d.windMax, weatherCode: d.code })),
      advice,
    };
  }

  private async fetchOpenMeteo(lat: number, lng: number): Promise<{ fetchedAt: string; days: DailyWeather[] }> {
    const url = new URL(this.cfg.openMeteoUrl);
    url.search = new URLSearchParams({
      latitude: lat.toFixed(4), longitude: lng.toFixed(4), timezone: "auto", forecast_days: "7",
      daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,relative_humidity_2m_mean,wind_speed_10m_max,weather_code",
    }).toString();
    let res: Response;
    try { res = await fetch(url, { signal: AbortSignal.timeout(5000) }); } catch (e) {
      this.log.warn({ err: (e as Error).message }, "open-meteo unreachable");
      throw new AppError(502, "weather_unavailable", "Bad gateway", "Weather service is unavailable");
    }
    if (!res.ok) throw new AppError(502, "weather_unavailable", "Bad gateway", `Weather service returned ${res.status}`);
    const j = (await res.json()) as { daily: Record<string, (number | null)[]> & { time: string[] } };
    const d = j.daily;
    return {
      fetchedAt: new Date().toISOString(),
      days: d.time.map((t, i) => ({
        date: t, tMin: d.temperature_2m_min?.[i] ?? 0, tMax: d.temperature_2m_max?.[i] ?? 0, precip: d.precipitation_sum?.[i] ?? 0,
        precipProb: d.precipitation_probability_max?.[i] ?? null, humidity: d.relative_humidity_2m_mean?.[i] ?? null,
        windMax: d.wind_speed_10m_max?.[i] ?? null, code: d.weather_code?.[i] ?? null,
      })),
    };
  }

  // ── export insights ──
  async exportInsights(q: { commodity_id: string; country?: string; destination?: string }, hints: DisplayHints, user: AuthUser) {
    const ctx = await this.money.resolveDisplay(hints, user, q.country);
    const c = await this.sql.one<{ hs_code: string | null; category_id: string }>(`SELECT hs_code, category_id FROM commodities WHERE id = $1`, [q.commodity_id]);
    if (!c) throw AppError.notFound("commodity");
    const usdTo = await this.money.usdTo(ctx.currency);
    const trend = await this.sql.many<{ period: Date; destination: string; usd: string; vol: string | null }>(
      `SELECT period, destination, avg(price_usd_per_kg)::text AS usd, sum(volume_tonnes)::text AS vol FROM export_prices
       WHERE commodity_id = $1 AND origin_iso2 = $2 AND ($3::text IS NULL OR destination = $3) AND period >= now() - interval '24 months'
       GROUP BY period, destination ORDER BY period`, [q.commodity_id, ctx.country, q.destination ?? null]);
    const domestic = await this.sql.one<{ usd: string | null }>(
      `SELECT (sum(sum_kg_usd) / nullif(sum(n), 0))::text AS usd FROM price_daily
       WHERE commodity_id = $1 AND country_iso2 = $2 AND price_type = 'wholesale' AND bucket >= now() - interval '90 days'`, [q.commodity_id, ctx.country]);
    const recentExport = trend.filter((t) => t.period.getTime() >= Date.now() - 90 * 86_400_000).map((t) => Number(t.usd));
    const exportAvg = recentExport.length ? recentExport.reduce((a, b) => a + b, 0) / recentExport.length : null;

    const reqs = await this.sql.many<{ destination: string; code: string; title: Record<string, string>; description: Record<string, string>; mandatory: boolean; authority: string | null; url: string | null }>(
      `SELECT destination, code, title, description, mandatory, authority, url FROM export_requirements
       WHERE ($1::text IS NULL OR destination = $1) AND (commodity_id = $2 OR category_id = $3 OR (commodity_id IS NULL AND category_id IS NULL))
       ORDER BY destination, mandatory DESC, sort_order`, [q.destination ?? null, q.commodity_id, c.category_id]);
    return {
      commodityId: q.commodity_id, hsCode: c.hs_code, currency: ctx.currency,
      trend: trend.map((t) => ({
        period: t.period.toISOString().slice(0, 7), destination: t.destination, priceUsdPerKg: fmt(t.usd, 4),
        display: usdTo ? fmt(D(t.usd).mul(usdTo), 2) : undefined, volumeTonnes: t.vol != null ? Number(t.vol) : null,
      })),
      premiumOverDomesticPct: exportAvg != null && domestic?.usd ? pctChange(exportAvg, domestic.usd) : null,
      requirements: reqs.map((r) => ({
        destination: r.destination, code: r.code, title: this.i18n.pick(r.title, ctx.locale), description: this.i18n.pick(r.description, ctx.locale),
        mandatory: r.mandatory, authority: r.authority ?? undefined, url: r.url ?? undefined,
      })),
    };
  }

  private async commodityName(id: string, locale: string) {
    const r = await this.sql.one<{ name: Record<string, string> }>(`SELECT name FROM commodities WHERE id = $1`, [id]);
    if (!r) throw AppError.notFound("commodity");
    return this.i18n.pick(r.name, locale);
  }
}
