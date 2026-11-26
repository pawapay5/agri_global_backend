import type Anthropic from "@anthropic-ai/sdk";
import type { AuthUser } from "../../common/auth/auth.common";
import type { Sql } from "../../common/db/database.module";
import type { CatalogueService } from "../catalogue/catalogue.service";
import type { ForecastsService } from "../forecasts/forecasts.service";
import type { InsightsService } from "../insights/insights.service";
import type { PricesService } from "../prices/prices.service";

/**
 * The assistant's only sources of facts. Every number it may quote comes from one of these tools, and every price or
 * forecast it reads is recorded as a Fact so the app can show the exact figures next to the (machine-translated) answer.
 */
export type Fact =
  | { kind: "price"; commodity: string; market: string; priceType: string; amount: string; currency: string; unit: string; observedAt: string; changePctWoW: number | null }
  | { kind: "forecast"; commodity: string; place: string; priceType: string; horizonMonths: number; targetDate: string; low: string; mid: string; high: string; currency: string; unit: string; confidence: string | null };

export interface ToolDeps { sql: Sql; catalogue: CatalogueService; prices: PricesService; forecasts: ForecastsService; insights: InsightsService }
export interface ToolContext { user: AuthUser; regionId: string | null; facts: Fact[] }

const PRICE_TYPES = ["wholesale", "retail", "farmgate"] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Prices older than this are reported as old, so the model can say so. */
export const STALE_PRICE_DAYS = 30;

const en = (n: unknown): string => {
  if (typeof n === "string") return n;
  if (n && typeof n === "object") { const o = n as Record<string, string>; return o.en ?? Object.values(o)[0] ?? ""; }
  return "";
};

const obj = (properties: Record<string, unknown>, required: string[]): Anthropic.Beta.BetaTool["input_schema"] =>
  ({ type: "object", properties, required, additionalProperties: false });

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "find_crop_or_place",
    description: "Look up crops (commodities), markets and regions by name, including local names (e.g. 'aburow' for maize, 'Techiman', 'Ashanti'). Call this first to get the ids the other tools need. Returns at most 5 of each.",
    input_schema: obj({ query: { type: "string", description: "A crop, market or region name, in English or a local spelling" } }, ["query"]),
    strict: true,
  },
  {
    name: "get_latest_prices",
    description: `Latest approved prices for one crop, market by market, from the last 120 days. Each row has the market, price, unit, currency, date observed and week-on-week change. Rows older than ${STALE_PRICE_DAYS} days are marked stale. Optionally limited to a region.`,
    input_schema: obj({
      commodity_id: { type: "string", description: "Commodity id from find_crop_or_place" },
      price_type: { type: "string", enum: [...PRICE_TYPES], description: "wholesale unless the farmer asks about retail or farm-gate prices" },
      region_id: { type: ["string", "null"], description: "Region id to narrow to, or null for the whole country" },
    }, ["commodity_id", "price_type", "region_id"]),
    strict: true,
  },
  {
    name: "get_price_forecast",
    description: "The machine-learning price forecast for a crop at a market (or a region) for 1, 3 and 6 months ahead, with a low-high range. Forecasts are withheld when data is too old, too short or too unreliable; the reasons are returned and must be explained, never replaced with a guess.",
    input_schema: obj({
      commodity_id: { type: "string" },
      price_type: { type: "string", enum: [...PRICE_TYPES] },
      market_id: { type: ["string", "null"], description: "Market id, or null to use region_id" },
      region_id: { type: ["string", "null"], description: "Region id when no market is given; null uses the farmer's own region" },
    }, ["commodity_id", "price_type", "market_id", "region_id"]),
    strict: true,
  },
  {
    name: "get_weather_advice",
    description: "7-day weather for a region (rain, temperature) and the farming advice rules that apply this week. Null region uses the farmer's own region.",
    input_schema: obj({ region_id: { type: ["string", "null"] } }, ["region_id"]),
    strict: true,
  },
  {
    name: "get_planting_advice",
    description: "Crops that can be planted in a region in a given month, from the crop calendar, with the expected harvest-time price change. Null region uses the farmer's own region; null month means this month.",
    input_schema: obj({ region_id: { type: ["string", "null"] }, month: { type: ["integer", "null"], minimum: 1, maximum: 12 } }, ["region_id", "month"]),
    strict: true,
  },
];

type Input = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const id = (v: unknown) => { const s = str(v); return s && uuid.test(s) ? s : null; };
const priceType = (v: unknown) => (PRICE_TYPES as readonly string[]).includes(String(v)) ? (v as (typeof PRICE_TYPES)[number]) : "wholesale";

class ToolInputError extends Error {}

/** Runs one tool call. Returns JSON text for the model; errors are returned (is_error) rather than thrown, so the model can recover. */
export async function runTool(name: string, input: Input, deps: ToolDeps, ctx: ToolContext): Promise<{ content: string; isError: boolean }> {
  try {
    const out = await dispatch(name, input, deps, ctx);
    return { content: JSON.stringify(out), isError: false };
  } catch (e) {
    const msg = e instanceof ToolInputError ? e.message : (e as { detail?: string; message?: string }).detail ?? "This data is unavailable right now.";
    return { content: JSON.stringify({ error: msg }), isError: true };
  }
}

async function commodityName(sql: Sql, commodityId: string) {
  return en((await sql.one<{ name: unknown }>(`SELECT name FROM commodities WHERE id = $1`, [commodityId]))?.name) || "this crop";
}

async function regionCentroid(sql: Sql, regionId: string) {
  return sql.one<{ lat: number; lng: number; name: unknown }>(
    `SELECT ST_Y(centroid::geometry) AS lat, ST_X(centroid::geometry) AS lng, name FROM regions WHERE id = $1 AND centroid IS NOT NULL`, [regionId]);
}

async function dispatch(name: string, input: Input, d: ToolDeps, ctx: ToolContext): Promise<unknown> {
  const country = ctx.user.country;
  switch (name) {
    case "find_crop_or_place": {
      const q = str(input.query)?.slice(0, 80);
      if (!q) throw new ToolInputError("query is required");
      const [found, regions] = await Promise.all([
        d.catalogue.search(q, country, 5),
        d.sql.many<{ id: string; name: unknown; level: number }>(
          `SELECT id, name, level FROM regions WHERE country_iso2 = $1 AND immutable_unaccent(jsonb_text_values(name)) ILIKE '%' || immutable_unaccent($2) || '%'
           ORDER BY level, id LIMIT 5`, [country, q]),
      ]);
      return {
        crops: found.commodities.slice(0, 5).map((c) => ({ id: c.id, name: en(c.name) })),
        markets: found.markets.slice(0, 5).map((m) => ({ id: m.id, name: en(m.name), region: m.regionName ? en(m.regionName) : null })),
        regions: regions.map((r) => ({ id: r.id, name: en(r.name), level: r.level })),
      };
    }
    case "get_latest_prices": {
      const commodityId = id(input.commodity_id);
      if (!commodityId) throw new ToolInputError("commodity_id must be an id from find_crop_or_place");
      const pt = priceType(input.price_type);
      const rows = await d.prices.latest({ commodity_id: commodityId, price_type: pt, country, region_id: id(input.region_id) ?? undefined }, {}, ctx.user);
      const crop = await commodityName(d.sql, commodityId);
      const now = Date.now();
      const out = rows.slice(0, 8).map((r) => {
        const stale = now - new Date(r.observedAt).getTime() > STALE_PRICE_DAYS * 86_400_000;
        const p = r.value.display;
        ctx.facts.push({ kind: "price", commodity: crop, market: en(r.marketName), priceType: pt, amount: p.amount ?? "", currency: p.currency, unit: p.unit,
          observedAt: r.observedAt.slice(0, 10), changePctWoW: r.changePctWoW ?? null });
        return { market: en(r.marketName), price: p.amount, currency: p.currency, per: p.unit, observed: r.observedAt.slice(0, 10), stale, changePctWeekOnWeek: r.changePctWoW ?? null };
      });
      return { crop, priceType: pt, today: new Date().toISOString().slice(0, 10), markets: out, note: out.length ? undefined : "No approved prices for this crop in the last 120 days." };
    }
    case "get_price_forecast": {
      const commodityId = id(input.commodity_id);
      if (!commodityId) throw new ToolInputError("commodity_id must be an id from find_crop_or_place");
      const marketId = id(input.market_id), regionId = marketId ? null : id(input.region_id) ?? ctx.regionId;
      if (!marketId && !regionId) throw new ToolInputError("Give a market_id or region_id (the farmer has no region on their profile)");
      const pt = priceType(input.price_type);
      const f = await d.forecasts.get({ commodity_id: commodityId, price_type: pt, market_id: marketId ?? undefined, region_id: regionId ?? undefined }, {}, ctx.user) as Record<string, any>;
      const crop = await commodityName(d.sql, commodityId);
      const place = marketId
        ? en((await d.sql.one<{ name: unknown }>(`SELECT name FROM markets WHERE id = $1`, [marketId]))?.name)
        : en((await d.sql.one<{ name: unknown }>(`SELECT name FROM regions WHERE id = $1`, [regionId]))?.name);
      if (f.status !== "available") {
        return { crop, place, status: "withheld", reasons: f.reasons, lastPriceDate: f.lastObservedAt ?? null,
          explain: "stale_data = newest price is more than 21 days old; insufficient_history = under 26 weeks of prices; backtest_mape_above_25 = past forecasts were off by more than 25%; no_forecast = none made yet." };
      }
      const horizons = (f.horizons as Record<string, any>[]).filter((h) => h.status === "available").map((h) => {
        ctx.facts.push({ kind: "forecast", commodity: crop, place, priceType: pt, horizonMonths: h.horizonMonths, targetDate: h.targetDate, low: h.p10, mid: h.p50, high: h.p90,
          currency: f.currency, unit: f.unit, confidence: h.confidence ?? null });
        return { monthsAhead: h.horizonMonths, date: h.targetDate, low: h.p10, likely: h.p50, high: h.p90, changeVsLatestPct: h.changePctVsLatest, confidence: h.confidence };
      });
      return { crop, place, status: "available", currency: f.currency, per: f.unit, latestPrice: f.latestActual, asOf: f.asOfDate, horizons };
    }
    case "get_weather_advice": {
      const regionId = id(input.region_id) ?? ctx.regionId;
      if (!regionId) throw new ToolInputError("Ask which region or town the farmer is in, then look it up");
      const c = await regionCentroid(d.sql, regionId);
      if (!c) throw new ToolInputError("No map location for that region");
      const w = await d.insights.weather({ lat: c.lat, lng: c.lng }, ctx.user);
      return {
        region: en(c.name), source: "Open-Meteo", fetchedAt: w.fetchedAt,
        days: w.days.map((x) => ({ date: x.date, minC: x.tempMinC, maxC: x.tempMaxC, rainMm: x.precipitationMm, rainChancePct: x.precipitationProbabilityPct })),
        advice: w.advice.map((a) => ({ severity: a.severity, text: a.text })),
      };
    }
    case "get_planting_advice": {
      const regionId = id(input.region_id) ?? ctx.regionId;
      if (!regionId) throw new ToolInputError("Ask which region the farmer is in, then look it up");
      const month = typeof input.month === "number" && input.month >= 1 && input.month <= 12 ? input.month : undefined;
      const rows = await d.insights.planting({ region_id: regionId, month }, ctx.user);
      return { month: month ?? new Date().getUTCMonth() + 1, crops: rows.slice(0, 8).map((r) => ({ crop: en(r.commodityName), plantingMonths: r.plantingWindow, harvestMonths: r.harvestMonths,
        expectedHarvestPriceChangePct: r.expectedHarvestPriceChangePct, reasons: r.reasons })) };
    }
    default:
      throw new ToolInputError(`Unknown tool ${name}`);
  }
}
