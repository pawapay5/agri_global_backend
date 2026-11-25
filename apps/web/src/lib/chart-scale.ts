export type Scale = ((v: number) => number) & { invert: (px: number) => number; domain: [number, number] };

export function linear([d0, d1]: [number, number], [r0, r1]: [number, number]): Scale {
  const span = d1 - d0 || 1;
  const f = ((v: number) => r0 + ((v - d0) / span) * (r1 - r0)) as Scale;
  f.invert = (px: number) => d0 + ((px - r0) / (r1 - r0 || 1)) * span;
  f.domain = [d0, d1];
  return f;
}

/** "Nice" round ticks (1, 2, 2.5, 5 × 10^k) covering [min, max]; the domain snaps out to the first/last tick. */
export function niceTicks(min: number, max: number, count = 5): { ticks: number[]; domain: [number, number] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [], domain: [0, 1] };
  if (min === max) { const pad = Math.abs(min) * 0.1 || 1; min -= pad; max += pad; }
  const raw = (max - min) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return { ticks, domain: [lo, hi] };
}

const DAY = 86_400_000;

/** Evenly spaced time ticks snapped to UTC midnights, at most `count`, always inside [t0, t1]. */
export function timeTicks(t0: number, t1: number, count = 5): number[] {
  if (!(t1 > t0)) return Number.isFinite(t0) ? [t0] : [];
  const step = Math.max(DAY, Math.ceil((t1 - t0) / Math.max(1, count - 1) / DAY) * DAY);
  const start = Math.ceil(t0 / DAY) * DAY;
  const out: number[] = [];
  for (let t = start; t <= t1 && out.length < count; t += step) out.push(t);
  return out;
}

/** SVG path through points, skipping gaps (null y) so a missing week never draws a fake bridge. */
export function linePath(points: { x: number; y: number | null }[]): string {
  let d = "", pen = false;
  for (const p of points) {
    if (p.y == null || !Number.isFinite(p.y)) { pen = false; continue; }
    d += `${pen ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** Closed band polygon between lower and upper edges (same x positions). */
export function bandPath(points: { x: number; lo: number; hi: number }[]): string {
  if (points.length < 2) return "";
  const top = points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.hi.toFixed(1)}`).join("");
  const bottom = [...points].reverse().map((p) => `L${p.x.toFixed(1)},${p.lo.toFixed(1)}`).join("");
  return `${top}${bottom}Z`;
}

/** Index of the point whose x is closest to `px` (points sorted by x). */
export function nearestIndex(xs: number[], px: number): number {
  if (!xs.length) return -1;
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid]! < px) lo = mid; else hi = mid; }
  return Math.abs(xs[lo]! - px) <= Math.abs(xs[hi]! - px) ? lo : hi;
}
