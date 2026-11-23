/** Pure price-quality and statistics logic (unit-tested; no I/O). */

export const MAD_SCALE = 1.4826;           // makes MAD a consistent estimator of σ under normality
export const OUTLIER_FLAG_Z = 3.5;         // Iglewicz & Hoaglin threshold
export const CROWD_AUTO_APPROVE_Z = 2.0;
export const MIN_REFERENCE_SAMPLES = 8;

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Robust z-score of `x` against a reference window (rolling MAD). Computed on log prices:
 * price noise is multiplicative, so a jump to 2× and one to 0.5× score symmetrically.
 * Returns null when there is too little reference data to judge.
 */
export function robustZ(x: number, reference: number[]): number | null {
  const ref = reference.filter((v) => v > 0 && Number.isFinite(v)).map(Math.log);
  if (ref.length < MIN_REFERENCE_SAMPLES || !(x > 0)) return null;
  const med = median(ref);
  let spread = MAD_SCALE * median(ref.map((v) => Math.abs(v - med)));
  if (spread === 0) {
    // Many identical prices: fall back to mean absolute deviation (×√(π/2)).
    spread = 1.2533 * (ref.reduce((a, v) => a + Math.abs(v - med), 0) / ref.length);
  }
  if (spread === 0) return Math.log(x) === med ? 0 : Math.sign(Math.log(x) - med) * Infinity;
  return (Math.log(x) - med) / spread;
}

export type Source = "source_pull" | "crowd" | "admin_csv" | "enumerator";
export type Status = "pending" | "approved" | "flagged" | "rejected";

export interface StatusDecision { status: Status; flags: string[] }

/**
 * Routing rules:
 *  - extreme outliers are always flagged for review;
 *  - trusted sources (pulls, CSV by staff, enumerators) auto-approve otherwise;
 *  - crowd submissions auto-approve only when clearly in range AND corroborated.
 */
export function decideStatus(source: Source, z: number | null, opts: { corroborated: boolean; sourceTrust?: number }): StatusDecision {
  const flags: string[] = [];
  if (z === null) flags.push("insufficient_reference");
  else if (Math.abs(z) > OUTLIER_FLAG_Z) flags.push(z > 0 ? "outlier_high" : "outlier_low");

  if (flags.some((f) => f.startsWith("outlier"))) return { status: "flagged", flags };
  if (source === "crowd") {
    if (z !== null && Math.abs(z) <= CROWD_AUTO_APPROVE_Z && opts.corroborated) return { status: "approved", flags };
    if (!opts.corroborated) flags.push("uncorroborated");
    return { status: "pending", flags };
  }
  if ((opts.sourceTrust ?? 1) < 0.5) return { status: "pending", flags: [...flags, "low_trust_source"] };
  return { status: "approved", flags };
}

export interface HardValidation { ok: boolean; field?: string; message?: string }
export function validateObservation(o: { amount: number; observedAt: Date; now?: Date }): HardValidation {
  const now = o.now ?? new Date();
  if (!(o.amount > 0) || !Number.isFinite(o.amount)) return { ok: false, field: "amount", message: "Amount must be a positive number" };
  if (o.amount > 1e9) return { ok: false, field: "amount", message: "Amount is implausibly large" };
  if (o.observedAt.getTime() > now.getTime() + 15 * 60_000) return { ok: false, field: "observedAt", message: "Observation date is in the future" };
  if (o.observedAt.getTime() < Date.UTC(1990, 0, 1)) return { ok: false, field: "observedAt", message: "Observation date is too old" };
  return { ok: true };
}

// ── series statistics ──

export interface SeriesPoint { t: Date; avg: number }
export interface Stats {
  high: number | null; low: number | null; average: number | null; latest: number | null; changePctWoW: number | null;
  volatility: { cv: number | null; bandLow: number | null; bandHigh: number | null; label: "low" | "moderate" | "high" | "insufficient_data" };
}

const round = (v: number, dp = 4) => Math.round(v * 10 ** dp) / 10 ** dp;

export function seriesStats(points: SeriesPoint[], now = new Date()): Stats {
  const vals = points.map((p) => p.avg).filter(Number.isFinite);
  if (!vals.length) return { high: null, low: null, average: null, latest: null, changePctWoW: null, volatility: { cv: null, bandLow: null, bandHigh: null, label: "insufficient_data" } };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = vals.length > 1 ? Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / (vals.length - 1)) : 0;
  const cv = mean > 0 && vals.length >= 4 ? sd / mean : null;
  const label = cv === null ? "insufficient_data" : cv < 0.08 ? "low" : cv < 0.2 ? "moderate" : "high";

  // Week-over-week: mean of last 7 days vs. the 7 days before, anchored on the latest point.
  const sorted = [...points].sort((a, b) => a.t.getTime() - b.t.getTime());
  const anchor = sorted.length ? sorted[sorted.length - 1]!.t.getTime() : now.getTime();
  const day = 86_400_000;
  const win = (from: number, to: number) => sorted.filter((p) => p.t.getTime() > anchor - to * day && p.t.getTime() <= anchor - from * day).map((p) => p.avg);
  const cur = win(0, 7), prev = win(7, 14);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const wow = cur.length && prev.length && avg(prev) > 0 ? round(((avg(cur) - avg(prev)) / avg(prev)) * 100, 2) : null;

  return {
    high: Math.max(...vals), low: Math.min(...vals), average: round(mean), latest: sorted[sorted.length - 1]?.avg ?? null, changePctWoW: wow,
    volatility: { cv: cv === null ? null : round(cv), bandLow: sd ? round(Math.max(0, mean - sd)) : null, bandHigh: sd ? round(mean + sd) : null, label },
  };
}

export const RANGE_DAYS: Record<string, number | null> = { "1M": 30, "3M": 90, "6M": 180, "1Y": 365, ALL: null };
