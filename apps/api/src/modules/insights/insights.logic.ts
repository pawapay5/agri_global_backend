/** Pure insight logic: seasonality, recommendation rules, and weather → advice rules. */

// ── seasonality ──
export interface MonthlyPoint { year: number; month: number; avg: number }
export interface SeasonalProfile {
  years: { year: number; months: (number | null)[] }[];
  monthlyAverage: (number | null)[];
  peakMonths: number[];
  lowMonths: number[];
  avgMonthlyChangePct: (number | null)[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function seasonalProfile(points: MonthlyPoint[], yearsBack = 3, now = new Date()): SeasonalProfile {
  const lastYear = now.getUTCFullYear();
  const years = Array.from({ length: yearsBack }, (_, i) => lastYear - yearsBack + 1 + i);
  const grid = new Map<string, number>();
  for (const p of points) grid.set(`${p.year}-${p.month}`, p.avg);
  const yearRows = years.map((y) => ({ year: y, months: Array.from({ length: 12 }, (_, m) => grid.get(`${y}-${m + 1}`) ?? null) }));

  // Index each year to its own mean so a high-inflation year doesn't dominate the shape.
  const indexed = yearRows.map((y) => {
    const vals = y.months.filter((v): v is number => v != null);
    const mean = vals.length >= 6 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return y.months.map((v) => (v != null && mean ? v / mean : null));
  });
  const monthlyIndex = Array.from({ length: 12 }, (_, m) => {
    const xs = indexed.map((row) => row[m]).filter((v): v is number => v != null);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  });
  const monthlyAverage = Array.from({ length: 12 }, (_, m) => {
    const xs = yearRows.map((y) => y.months[m]).filter((v): v is number => v != null);
    return xs.length ? r2(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  });

  const valid = monthlyIndex.map((v, i) => ({ v, m: i + 1 })).filter((x): x is { v: number; m: number } => x.v != null);
  let peakMonths: number[] = [], lowMonths: number[] = [];
  if (valid.length >= 6) {
    const max = Math.max(...valid.map((x) => x.v)), min = Math.min(...valid.map((x) => x.v));
    const tol = (max - min) * 0.1;
    peakMonths = valid.filter((x) => x.v >= max - tol).map((x) => x.m);
    lowMonths = valid.filter((x) => x.v <= min + tol).map((x) => x.m);
  }

  // Mean month-on-month % change for each calendar month (Jan compares to the previous Dec).
  const avgMonthlyChangePct = Array.from({ length: 12 }, (_, m) => {
    const changes: number[] = [];
    for (const y of years) {
      const cur = grid.get(`${y}-${m + 1}`);
      const prev = m === 0 ? grid.get(`${y - 1}-12`) : grid.get(`${y}-${m}`);
      if (cur != null && prev != null && prev > 0) changes.push(((cur - prev) / prev) * 100);
    }
    return changes.length ? r2(changes.reduce((a, b) => a + b, 0) / changes.length) : null;
  });
  return { years: yearRows, monthlyAverage, peakMonths, lowMonths, avgMonthlyChangePct };
}

// ── recommendations ──
export type Confidence = "high" | "medium" | "low";
export interface RecInput {
  horizons: { months: number; changePct: number | null; confidence: Confidence }[];
  perishability: "low" | "medium" | "high";
  peakMonths: number[];
  alternatives: { marketId: string; name: string; distanceKm: number; marginPct: number }[];
}
export interface Rec {
  kind: "sell_now" | "hold" | "alternative_market";
  i18nKey: string; titleKey: string; params: Record<string, string | number>;
  confidence: Confidence; expectedChangePct: number | null; marginPct: number | null; marketId: string | null;
  basis: ("forecast" | "seasonality" | "spatial_spread" | "perishability")[];
}

const worse = (a: Confidence, b: Confidence): Confidence => (a === "low" || b === "low" ? "low" : a === "medium" || b === "medium" ? "medium" : "high");

export const SELL_THRESHOLD_PCT = -5;
export const HOLD_THRESHOLD_PCT = 8;
export const ALT_MARKET_MIN_MARGIN_PCT = 10;

export function recommend(i: RecInput): Rec[] {
  const out: Rec[] = [];
  const h1 = i.horizons.find((h) => h.months === 1);
  const h3 = i.horizons.find((h) => h.months === 3);
  const usable = (h?: { confidence: Confidence; changePct: number | null }) => h && h.changePct != null && h.confidence !== "low";

  if (usable(h1) && h1!.changePct! <= SELL_THRESHOLD_PCT) {
    out.push({ kind: "sell_now", titleKey: "rec.sell_now.title", i18nKey: "rec.sell_now.rationale", params: { pct: Math.abs(h1!.changePct!).toFixed(0), months: 1 },
      confidence: h1!.confidence, expectedChangePct: h1!.changePct, marginPct: null, marketId: null, basis: ["forecast"] });
  } else if (usable(h3) && h3!.changePct! >= HOLD_THRESHOLD_PCT) {
    if (i.perishability === "high") {
      out.push({ kind: "sell_now", titleKey: "rec.sell_now.title", i18nKey: "rec.sell_now.perishable", params: {},
        confidence: worse(h3!.confidence, "medium"), expectedChangePct: h3!.changePct, marginPct: null, marketId: null, basis: ["forecast", "perishability"] });
    } else {
      out.push({ kind: "hold", titleKey: "rec.hold.title", i18nKey: "rec.hold.rationale", params: { pct: h3!.changePct!.toFixed(0), months: 3 },
        confidence: i.perishability === "medium" ? worse(h3!.confidence, "medium") : h3!.confidence,
        expectedChangePct: h3!.changePct, marginPct: null, marketId: null, basis: i.peakMonths.length ? ["forecast", "seasonality"] : ["forecast"] });
    }
  }

  const best = [...i.alternatives].filter((a) => a.marginPct >= ALT_MARKET_MIN_MARGIN_PCT).sort((a, b) => b.marginPct - a.marginPct)[0];
  if (best) {
    out.push({ kind: "alternative_market", titleKey: "rec.alt_market.title", i18nKey: "rec.alt_market.rationale",
      params: { market: best.name, distance: Math.round(best.distanceKm), margin: best.marginPct.toFixed(0) },
      confidence: best.distanceKm <= 100 ? "medium" : "low", expectedChangePct: null, marginPct: r2(best.marginPct), marketId: best.marketId, basis: ["spatial_spread"] });
  }
  return out;
}

// ── weather → advice rules ──
export interface DailyWeather { date: string; tMin: number; tMax: number; precip: number; precipProb: number | null; humidity: number | null; windMax: number | null; code: number | null }
export type Metrics = Record<string, number>;

export function weatherMetrics(days: DailyWeather[]): Metrics {
  const precip = days.map((d) => d.precip);
  let maxRolling3 = 0;
  for (let i = 0; i < precip.length; i++) maxRolling3 = Math.max(maxRolling3, precip.slice(i, i + 3).reduce((a, b) => a + b, 0));
  let dryRun = 0;
  for (const p of precip) { if (p < 1) dryRun++; else break; }
  const hum = days.map((d) => d.humidity).filter((v): v is number => v != null);
  return {
    precip_sum_7d: r2(precip.reduce((a, b) => a + b, 0)),
    precip_max_3d: r2(maxRolling3),
    dry_days_ahead: dryRun,
    temp_max: Math.max(...days.map((d) => d.tMax)),
    temp_mean: r2(days.reduce((a, d) => a + (d.tMax + d.tMin) / 2, 0) / Math.max(1, days.length)),
    humidity_mean: hum.length ? r2(hum.reduce((a, b) => a + b, 0) / hum.length) : 0,
    warm_humid_days: days.filter((d) => (d.tMax + d.tMin) / 2 >= 24 && (d.humidity ?? 0) >= 70).length,
    wind_max: Math.max(0, ...days.map((d) => d.windMax ?? 0)),
  };
}

type Cmp = { metric: string; op: ">=" | "<=" | ">" | "<" | "=="; value: number };
export type Condition = { all?: (Cmp | Condition)[]; any?: (Cmp | Condition)[] } | Cmp;

export function evalCondition(c: Condition, m: Metrics): boolean {
  if ("all" in c && c.all) return c.all.every((x) => evalCondition(x, m));
  if ("any" in c && c.any) return c.any.some((x) => evalCondition(x, m));
  const cmp = c as Cmp;
  const v = m[cmp.metric];
  if (v === undefined) return false;
  switch (cmp.op) {
    case ">=": return v >= cmp.value;
    case "<=": return v <= cmp.value;
    case ">": return v > cmp.value;
    case "<": return v < cmp.value;
    case "==": return v === cmp.value;
  }
}
