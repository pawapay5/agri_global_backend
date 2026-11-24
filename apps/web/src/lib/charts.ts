/** Pure chart data shaping (unit-tested). Amounts arrive as decimal strings. */

export interface HistoryPoint { t: string; avg: string }
export interface HorizonPoint { targetDate: string; status?: string; p10: string | null; p50: string | null; p90: string | null }
export interface ChartRow { t: number; actual?: number; p50?: number; band?: [number, number] }

const num = (v: string | null | undefined) => (v == null ? undefined : Number(v));

/**
 * One row per date. History rows carry `actual`; forecast rows carry `p50` and a `[p10, p90]` band.
 * The last actual point is duplicated into the forecast series so the dashed line starts where history ends.
 */
export function buildForecastSeries(history: HistoryPoint[], horizons: HorizonPoint[] = []): ChartRow[] {
  const rows: ChartRow[] = history
    .map((p) => ({ t: Date.parse(p.t), actual: num(p.avg) }))
    .filter((r) => Number.isFinite(r.t) && r.actual != null && Number.isFinite(r.actual))
    .sort((a, b) => a.t - b.t);
  const usable = horizons.filter((h) => (h.status ?? "available") === "available" && h.p50 != null && h.p10 != null && h.p90 != null);
  if (!usable.length) return rows;
  const last = rows[rows.length - 1];
  if (last) { last.p50 = last.actual; last.band = [last.actual!, last.actual!]; }
  for (const h of usable.sort((a, b) => Date.parse(a.targetDate) - Date.parse(b.targetDate))) {
    rows.push({ t: Date.parse(h.targetDate), p50: num(h.p50), band: [num(h.p10)!, num(h.p90)!] });
  }
  return rows;
}

/** Normalised SHAP bars: width is the share of total impact; sign gives the direction. */
export function shapBars(features: { feature: string; i18nKey: string; sharePct: number; contribution: number; direction: "up" | "down" }[]) {
  const max = Math.max(1, ...features.map((f) => f.sharePct));
  return features.map((f) => ({ ...f, widthPct: Math.round((f.sharePct / max) * 100) }));
}
