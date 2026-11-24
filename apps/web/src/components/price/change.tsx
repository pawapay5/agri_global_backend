import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn, formatPct } from "@/lib/utils";

/** Up/down change indicator. Colour is never the only signal: an arrow and a sign accompany it. */
export function Change({ pct, className }: { pct: number | null | undefined; className?: string }) {
  if (pct == null || !Number.isFinite(pct)) return <span className={cn("text-muted-fg", className)}>—</span>;
  const Icon = pct > 0 ? ArrowUpRight : pct < 0 ? ArrowDownRight : Minus;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-sm font-semibold tabular", pct > 0 ? "text-up" : pct < 0 ? "text-down" : "text-muted-fg", className)}>
      <Icon aria-hidden className="size-4" />
      <span>{formatPct(pct)}</span>
    </span>
  );
}

/** Tiny inline SVG trend line: works in server components and OG images (no chart lib). */
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
