import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ChangeBadge } from "./change-badge";

/**
 * Stat tile: label (sentence case) · value (proportional figures, pre-formatted by the caller from API display
 * fields) · optional delta vs a named period · optional 12-point trend in the de-emphasis hue with the latest
 * point accented · optional footer (usually <DataFreshness/>).
 */
export function StatCard({ label, value, delta, trend, icon, footer, className }: {
  label: string; value: ReactNode;
  delta?: { value: number | null | undefined; period?: string; upIsGood?: boolean };
  trend?: number[]; icon?: ReactNode; footer?: ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-2xl border border-border bg-card p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-fg">{label}</p>
        {icon ? <span aria-hidden className="text-muted-fg">{icon}</span> : null}
      </div>
      <p className="text-2xl font-semibold leading-tight">{value}</p>
      <div className="flex items-end justify-between gap-3">
        {delta ? <ChangeBadge value={delta.value} period={delta.period} upIsGood={delta.upIsGood} /> : <span />}
        {trend && trend.length > 1 ? <Trend values={trend.slice(-12)} /> : null}
      </div>
      {footer ? <div className="border-t border-border pt-2">{footer}</div> : null}
    </div>
  );
}

/** Tiny trend: muted line, accent end dot (the current period). Decorative: the value and delta carry the data. */
function Trend({ values }: { values: number[] }) {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return null;
  const W = 88, H = 28, min = Math.min(...v), span = Math.max(...v) - min || 1;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * (W - 6) + 1, H - 3 - ((y - min) / span) * (H - 6)] as const);
  const last = pts[pts.length - 1]!;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="shrink-0">
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--chart-axis)" strokeOpacity="0.55" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="4" fill="var(--chart-history)" stroke="var(--chart-surface)" strokeWidth="2" />
    </svg>
  );
}
