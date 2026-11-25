import { ChangeBadge } from "@/components/agri/change-badge";

/** Back-compat wrapper: week-on-week change as a ChangeBadge (arrow + sign + screen-reader text). */
export function Change({ pct, className }: { pct: number | null | undefined; className?: string }) {
  return <ChangeBadge value={pct} className={className} />;
}

/** Tiny inline SVG trend line: works in server components and OG images (no chart lib). Decorative. */
export function Sparkline({ values, width = 96, height = 28, className }: { values: number[]; width?: number; height?: number; className?: string }) {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return null;
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * width).toFixed(1)},${(height - ((y - min) / span) * (height - 4) - 2).toFixed(1)}`).join(" ");
  const up = v[v.length - 1]! >= v[0]!;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <polyline points={pts} fill="none" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
