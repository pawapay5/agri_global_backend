/** Seller KPIs, period-over-period change, demand and supply indices. */

export function periodChangePct(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / previous) * 10_000) / 100;
}

/** Weighted marketplace activity: an order signals far more demand than a view. */
export const ACTIVITY_WEIGHTS = { views: 1, favourites: 3, offers: 8, orders: 20 } as const;
export function activityScore(r: { views: number; favourites: number; offers: number; orders: number }): number {
  return r.views * ACTIVITY_WEIGHTS.views + r.favourites * ACTIVITY_WEIGHTS.favourites + r.offers * ACTIVITY_WEIGHTS.offers + r.orders * ACTIVITY_WEIGHTS.orders;
}

/**
 * Demand index (100 = normal). Blends marketplace activity relative to its trailing 12-week mean
 * with price momentum (4-week vs 12-week mean price): 70/30 in log space, so neither dominates.
 * Returns null when there isn't enough baseline to say anything.
 */
export function demandIndex(activity: number[], prices: (number | null)[], minBaselineWeeks = 6): (number | null)[] {
  return activity.map((a, i) => {
    const base = activity.slice(Math.max(0, i - 12), i);
    if (base.length < minBaselineWeeks) return null;
    const mean = base.reduce((s, x) => s + x, 0) / base.length;
    if (mean <= 0) return null;
    const actRatio = Math.max(a, 0.5) / mean; // floor avoids log(0) for a quiet week
    const p4 = prices.slice(Math.max(0, i - 3), i + 1).filter((x): x is number => x != null && x > 0);
    const p12 = prices.slice(Math.max(0, i - 11), i + 1).filter((x): x is number => x != null && x > 0);
    const priceRatio = p4.length && p12.length >= 4 ? (p4.reduce((s, x) => s + x, 0) / p4.length) / (p12.reduce((s, x) => s + x, 0) / p12.length) : 1;
    return Math.round(100 * Math.exp(0.7 * Math.log(actRatio) + 0.3 * Math.log(priceRatio)) * 10) / 10;
  });
}

/** Supply share per region (percent of national listed quantity). */
export function supplyShares(rows: { regionId: string | null; quantityKg: number }[]): { regionId: string | null; quantityKg: number; sharePct: number }[] {
  const total = rows.reduce((s, r) => s + r.quantityKg, 0);
  return rows.map((r) => ({ ...r, sharePct: total ? Math.round((r.quantityKg / total) * 10_000) / 100 : 0 })).sort((a, b) => b.quantityKg - a.quantityKg);
}

export const PERIOD_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 };
