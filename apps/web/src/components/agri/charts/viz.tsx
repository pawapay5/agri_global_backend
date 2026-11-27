"use client";
import { ArrowDown, ArrowUp, Minus, Table2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { linear, linePath, niceTicks } from "@/lib/chart-scale";
import { cn } from "@/lib/utils";

/**
 * Dashboard chart kit (SVG, no chart library). Shared rules: thin marks (bars ≤ 24px, 4px rounded data end, 2px
 * lines), hairline solid grid, a 2px surface gap between touching marks, a legend for 2+ series, selective direct
 * labels, text in text tokens (never the series colour), a tooltip that keyboard focus also opens, and a table twin
 * for every chart. Entrance animations come from globals.css and switch off under prefers-reduced-motion.
 */

export interface Series { key: string; name: string; color: string; icon?: ReactNode }
export interface TableSpec { caption: string; columns: string[]; rows: (string | number)[][] }

const BAR_MAX = 24;
const GAP = 2;

export function useWidth<T extends HTMLElement>(initial = 600) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(initial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(160, Math.floor(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Rounded data-end, square baseline: a column path (exported for tests). */
export function columnPath(x: number, y: number, w: number, h: number, r = 4) {
  if (h <= 0 || w <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** Chart card: title, optional subtitle, legend, a table toggle and the chart or its table. Holds its frame while refetching. */
export function VizCard({ title, subtitle, legend, table, action, fetching, className, children, headingLevel = 2 }: {
  title: string; subtitle?: ReactNode; legend?: Series[]; table?: TableSpec; action?: ReactNode; fetching?: boolean; className?: string; children: ReactNode; headingLevel?: 2 | 3;
}) {
  const t = useTranslations("ds");
  const [showTable, setShowTable] = useState(false);
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className={cn("rounded-2xl border border-border bg-card p-5 shadow-elev-1", className)} aria-label={title}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <H className="text-base font-semibold leading-tight">{title}</H>
          {subtitle ? <p className="mt-0.5 text-sm text-muted-fg">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-1">
          {action}
          {table ? (
            <button type="button" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-muted-fg hover:bg-muted hover:text-foreground">
              <Table2 aria-hidden className="size-3.5" />{showTable ? t("hideTable") : t("viewTable")}
            </button>
          ) : null}
        </div>
      </div>
      {legend && legend.length > 1 ? <Legend items={legend} /> : null}
      <div className={cn("transition-opacity", fetching && "opacity-60")}>
        {showTable && table ? <DataTable spec={table} /> : children}
      </div>
    </section>
  );
}

export function Legend({ items, line = false }: { items: Series[]; line?: boolean }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-fg">
      {items.map((s) => (
        <li key={s.key} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={line ? "h-0.5 w-3 rounded" : "size-2.5 rounded-[3px]"} style={{ background: s.color }} />
          {s.icon}{s.name}
        </li>
      ))}
    </ul>
  );
}

export function DataTable({ spec }: { spec: TableSpec }) {
  return (
    <div className="max-h-80 overflow-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <caption className="sr-only">{spec.caption}</caption>
        <thead className="sticky top-0 bg-muted text-muted-fg">
          <tr>{spec.columns.map((c, i) => <th key={c} scope="col" className={cn("px-3 py-2 font-medium", i ? "text-end" : "text-start")}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {spec.rows.map((r, ri) => (
            <tr key={ri} className="border-t border-border">
              {r.map((v, i) => i === 0
                ? <th key={i} scope="row" className="px-3 py-1.5 text-start font-normal">{v}</th>
                : <td key={i} className="px-3 py-1.5 text-end tabular">{v}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Floating readout: values lead, names follow, series keyed with a short line in their colour. */
function Tip({ x, y, width, title, rows }: { x: number; y: number; width: number; title: string; rows: { color: string; name: string; value: string }[] }) {
  const left = Math.min(Math.max(x, 80), width - 80);
  return (
    <div role="status" className="pointer-events-none absolute z-10 min-w-36 -translate-x-1/2 -translate-y-full rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-elev-2"
      style={{ left, top: Math.max(0, y - 10) }}>
      <p className="mb-1 font-medium text-muted-fg">{title}</p>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-3 shrink-0 rounded" style={{ background: r.color }} />
            <span className="font-semibold text-foreground">{r.value}</span><span className="text-muted-fg">{r.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const roving = (e: KeyboardEvent, n: number, cur: number | null, set: (i: number | null) => void) => {
  if (!n) return;
  const i = cur ?? -1;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); set(Math.min(n - 1, i + 1)); }
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); set(Math.max(0, i - 1)); }
  else if (e.key === "Home") { e.preventDefault(); set(0); }
  else if (e.key === "End") { e.preventDefault(); set(n - 1); }
  else if (e.key === "Escape") set(null);
};

// ── Column chart (one series, or up to 4 stacked) ──
export interface ColumnDatum { key: string; label: string; values: number[] }

export function ColumnChart({ data, series, format, height = 200, summary, tickEvery }: {
  data: ColumnDatum[]; series: Series[]; format: (v: number) => string; height?: number; summary: string; tickEvery?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const descId = useId();
  const M = { top: 8, right: 4, bottom: 22, left: 36 };
  const plotW = width - M.left - M.right, plotH = height - M.top - M.bottom;
  const totals = data.map((d) => d.values.reduce((a, b) => a + b, 0));
  const { ticks, domain } = niceTicks(0, Math.max(1, ...totals), 4);
  const y = linear(domain, [plotH, 0]);
  const band = plotW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(BAR_MAX, band - GAP));
  const every = tickEvery ?? Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(plotW / 70))));
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - M.left) / band);
    setActive(i >= 0 && i < data.length ? i : null);
  };
  const a = active != null ? data[active] : null;
  return (
    <div ref={ref} className="relative">
      <p id={descId} className="sr-only">{summary}</p>
      <svg width={width} height={height} role="img" aria-describedby={descId} tabIndex={0} aria-label={a ? `${a.label}: ${series.map((s, i) => `${s.name} ${format(a.values[i] ?? 0)}`).join(", ")}` : summary}
        className={cn("block outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg", active != null && "viz-dim")}
        onPointerMove={pick} onPointerLeave={() => setActive(null)} onKeyDown={(e) => roving(e, data.length, active, setActive)} onBlur={() => setActive(null)}>
        <g transform={`translate(${M.left},${M.top})`}>
          {ticks.map((tk) => (
            <g key={tk}>
              <line x1={0} x2={plotW} y1={y(tk)} y2={y(tk)} stroke="var(--chart-grid)" />
              <text x={-6} y={y(tk)} dy="0.32em" textAnchor="end" className="fill-[var(--chart-axis)] text-[10px] tabular">{format(tk)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = i * band + (band - barW) / 2;
            let acc = 0;
            const last = d.values.reduce((li, v, si) => (v > 0 ? si : li), -1);
            return (
              <g key={d.key} className="viz-mark" data-on={active === i ? "" : undefined}>
                {d.values.map((v, si) => {
                  if (v <= 0) return null;
                  const y0 = y(acc), y1 = y(acc + v);
                  acc += v;
                  // 2px surface gap between stacked segments; only the top segment gets the rounded end.
                  const h = Math.max(0, y0 - y1 - (si === last ? 0 : GAP));
                  return si === last
                    ? <path key={si} d={columnPath(x, y1, barW, h)} fill={series[si]!.color} className="viz-grow-y" style={{ ["--i" as string]: i }} />
                    : <rect key={si} x={x} y={y1 + GAP} width={barW} height={h} fill={series[si]!.color} className="viz-grow-y" style={{ ["--i" as string]: i }} />;
                })}
                {i % every === 0 ? <text x={x + barW / 2} y={plotH + 15} textAnchor="middle" className="fill-[var(--chart-axis)] text-[10px]">{d.label}</text> : null}
              </g>
            );
          })}
          <line x1={0} x2={plotW} y1={plotH} y2={plotH} stroke="var(--chart-axis)" strokeOpacity={0.5} />
        </g>
      </svg>
      {a ? <Tip x={M.left + active! * band + band / 2} y={M.top + y(totals[active!] ?? 0)} width={width} title={a.label}
        rows={series.map((s, i) => ({ color: s.color, name: s.name, value: format(a.values[i] ?? 0) }))} /> : null}
    </div>
  );
}

// ── Line chart (single series with a 10% wash; crosshair snaps to the nearest point) ──
export interface LinePoint { key: string; label: string; value: number | null }

export function LineChart({ points, color = "var(--viz-single)", format, height = 200, summary, area = true, name }: {
  points: LinePoint[]; color?: string; format: (v: number) => string; height?: number; summary: string; area?: boolean; name: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const gid = useId().replace(/:/g, "");
  const M = { top: 12, right: 56, bottom: 22, left: 40 };
  const plotW = width - M.left - M.right, plotH = height - M.top - M.bottom;
  const vals = points.map((p) => p.value).filter((v): v is number => v != null);
  const { ticks, domain } = niceTicks(Math.min(0, ...vals), Math.max(1, ...vals), 4);
  const x = linear([0, Math.max(1, points.length - 1)], [0, plotW]);
  const y = linear(domain, [plotH, 0]);
  const pts = points.map((p, i) => ({ x: x(i), y: p.value == null ? null : y(p.value) }));
  const line = linePath(pts);
  const lastI = points.map((p) => p.value != null).lastIndexOf(true);
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 80))));
  const areaD = area && lastI >= 0 ? `${line}L${x(lastI)},${plotH}L${x(points.findIndex((p) => p.value != null))},${plotH}Z` : "";
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(x.invert(e.clientX - r.left - M.left));
    setActive(Math.max(0, Math.min(points.length - 1, i)));
  };
  const a = active != null ? points[active] : null;
  return (
    <div ref={ref} className="relative">
      <svg width={width} height={height} role="img" tabIndex={0} aria-label={a ? `${a.label}: ${a.value == null ? "—" : format(a.value)}` : summary}
        className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerMove={pick} onPointerLeave={() => setActive(null)} onKeyDown={(e) => roving(e, points.length, active, setActive)} onBlur={() => setActive(null)}>
        <defs><linearGradient id={gid} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.14} /><stop offset="100%" stopColor={color} stopOpacity={0.02} /></linearGradient></defs>
        <g transform={`translate(${M.left},${M.top})`}>
          {ticks.map((tk) => (
            <g key={tk}>
              <line x1={0} x2={plotW} y1={y(tk)} y2={y(tk)} stroke="var(--chart-grid)" />
              <text x={-6} y={y(tk)} dy="0.32em" textAnchor="end" className="fill-[var(--chart-axis)] text-[10px] tabular">{format(tk)}</text>
            </g>
          ))}
          {points.map((p, i) => i % every === 0 ? <text key={p.key} x={x(i)} y={plotH + 15} textAnchor="middle" className="fill-[var(--chart-axis)] text-[10px]">{p.label}</text> : null)}
          {areaD ? <path d={areaD} fill={`url(#${gid})`} className="viz-fade" /> : null}
          <path d={line} pathLength={1} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="viz-draw" />
          {lastI >= 0 ? (
            <g className="viz-fade" style={{ ["--i" as string]: 12 }}>
              <circle cx={x(lastI)} cy={pts[lastI]!.y!} r={5} fill={color} stroke="var(--viz-gap)" strokeWidth={2} />
              <text x={x(lastI) + 9} y={pts[lastI]!.y!} dy="0.32em" className="fill-foreground text-[11px] font-semibold">{format(points[lastI]!.value!)}</text>
            </g>
          ) : null}
          {a ? (
            <g>
              <line x1={x(active!)} x2={x(active!)} y1={0} y2={plotH} stroke="var(--chart-axis)" strokeOpacity={0.6} />
              {a.value != null ? <circle cx={x(active!)} cy={y(a.value)} r={5} fill={color} stroke="var(--viz-gap)" strokeWidth={2} /> : null}
            </g>
          ) : null}
        </g>
      </svg>
      {a ? <Tip x={M.left + x(active!)} y={M.top + (a.value != null ? y(a.value) : plotH / 2)} width={width} title={a.label} rows={[{ color, name, value: a.value == null ? "—" : format(a.value) }]} /> : null}
    </div>
  );
}

/** Decorative trend line beside a stated value (the value and change are in text next to it). */
export function Sparkline({ values, color = "var(--viz-single)", width = 120, height = 36 }: { values: (number | null)[]; color?: string; width?: number; height?: number }) {
  const gid = useId().replace(/:/g, "");
  const v = values.filter((n): n is number => n != null);
  if (v.length < 2) return null;
  const min = Math.min(...v), max = Math.max(...v), pad = (max - min) * 0.1 || 1;
  const x = linear([0, values.length - 1], [2, width - 6]);
  const y = linear([min - pad, max + pad], [height - 3, 3]);
  const pts = values.map((n, i) => ({ x: x(i), y: n == null ? null : y(n) }));
  const d = linePath(pts);
  const li = values.map((n) => n != null).lastIndexOf(true), fi = values.findIndex((n) => n != null);
  return (
    <svg width={width} height={height} aria-hidden className="shrink-0 overflow-visible">
      <defs><linearGradient id={gid} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.16} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
      <path d={`${d}L${x(li)},${height}L${x(fi)},${height}Z`} fill={`url(#${gid})`} className="viz-fade" />
      <path d={d} pathLength={1} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="viz-draw" />
      <circle cx={x(li)} cy={pts[li]!.y!} r={3.5} fill={color} stroke="var(--viz-gap)" strokeWidth={2} className="viz-fade" style={{ ["--i" as string]: 10 }} />
    </svg>
  );
}

// ── Diverging bars: change around zero, one row per item, sign + arrow on every value ──
export interface DivergingRow { key: string; label: string; value: number; href?: string; sub?: string }

export function DivergingBars({ rows, format, renderLink }: {
  rows: DivergingRow[]; format: (v: number) => string; renderLink?: (r: DivergingRow, children: ReactNode) => ReactNode;
}) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className="space-y-1.5">
      {rows.map((r, i) => {
        const pct = (Math.abs(r.value) / max) * 50;
        const neg = r.value < 0, zero = r.value === 0;
        const Icon = zero ? Minus : neg ? ArrowDown : ArrowUp;
        const body = (
          <div className="grid grid-cols-[minmax(0,9rem)_1fr_4.5rem] items-center gap-3 rounded-lg px-1 py-1 sm:grid-cols-[minmax(0,12rem)_1fr_5rem]">
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{r.label}</span>{r.sub ? <span className="block truncate text-xs text-muted-fg">{r.sub}</span> : null}</span>
            <span className="relative h-4" aria-hidden>
              <span className="absolute inset-y-0 start-1/2 w-px bg-[var(--chart-axis)] opacity-50" />
              {zero ? null : (
                <span className="viz-grow-x absolute inset-y-0.5 rounded-[4px]" data-neg={neg ? "" : undefined}
                  style={{ ["--i" as string]: i * 2, background: neg ? "var(--viz-neg)" : "var(--viz-pos)", width: `${pct}%`, insetInlineStart: neg ? `${50 - pct}%` : "50%",
                    borderStartStartRadius: neg ? 4 : 0, borderEndStartRadius: neg ? 4 : 0, borderStartEndRadius: neg ? 0 : 4, borderEndEndRadius: neg ? 0 : 4 }} />
              )}
            </span>
            <span className="inline-flex items-center justify-end gap-0.5 text-sm font-semibold tabular"><Icon aria-hidden className="size-3.5" />{format(r.value)}</span>
          </div>
        );
        return <li key={r.key}>{renderLink && r.href ? renderLink(r, body) : body}</li>;
      })}
    </ul>
  );
}

// ── Ranked bars: compare parts with each other, one hue, value at the tip ──
export interface RankedRow { key: string; label: string; value: number; display: string; sub?: string }

export function RankedBars({ rows, color = "var(--viz-1)" }: { rows: RankedRow[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={r.key} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium">{r.label}{r.sub ? <span className="ms-1.5 text-xs font-normal text-muted-fg">{r.sub}</span> : null}</span>
            <span className="shrink-0 font-semibold tabular">{r.display}</span>
          </div>
          <div className="h-2.5 rounded-full bg-muted" aria-hidden>
            <div className="viz-grow-x h-full rounded-full" style={{ ["--i" as string]: i * 3, width: `${Math.max(1.5, (r.value / max) * 100)}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Segmented bar: one whole split into ≤ 6 parts. Shares sit in the legend beside each name, not on the blocks:
//    small text on mid-tone fills can't reach 4.5:1 in both themes. ──
export interface Part { key: string; name: string; value: number; color: string; icon?: ReactNode }

export const shares = (parts: { value: number }[]) => {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  return parts.map((p) => (total ? (Math.max(0, p.value) / total) * 100 : 0));
};

export function SegmentedBar({ parts, format, label }: { parts: Part[]; format: (v: number) => string; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const pct = shares(parts);
  const visible = parts.map((p, i) => ({ p, i, s: pct[i]! })).filter((x) => x.p.value > 0);
  return (
    <div className="space-y-3">
      <div ref={ref} className="relative">
        <div className="flex h-5 gap-[2px]" role="list" aria-label={label}>
          {visible.map(({ p, i, s }, vi) => (
            <div key={p.key} role="listitem" tabIndex={0} aria-label={`${p.name}: ${format(p.value)} (${Math.round(s)}%)`}
              onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
              className="viz-grow-x viz-mark rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-ring" data-on={active === i ? "" : undefined}
              style={{ ["--i" as string]: vi * 4, flexBasis: `${s}%`, flexGrow: 0, flexShrink: 1, minWidth: 3, background: p.color }} />
          ))}
        </div>
        {active != null ? <Tip x={(pct.slice(0, active).reduce((a, b) => a + b, 0) + pct[active]! / 2) / 100 * width} y={0} width={width} title={parts[active]!.name}
          rows={[{ color: parts[active]!.color, name: `${Math.round(pct[active]!)}%`, value: format(parts[active]!.value) }]} /> : null}
      </div>
      <Legend items={parts.map((p, i) => ({ key: p.key, name: `${p.name} · ${Math.round(pct[i]!)}%`, color: p.color, icon: p.icon }))} />
    </div>
  );
}

// ── Funnel: ordered stages, one hue stepped light → dark, conversion between stages ──
export function Funnel({ stages, format, conversionLabel }: { stages: { key: string; name: string; value: number }[]; format: (v: number) => string; conversionLabel: (pct: string) => string }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  const ramp = ["var(--viz-ord-1)", "var(--viz-ord-2)", "var(--viz-ord-3)", "var(--viz-ord-4)"];
  return (
    <ol className="space-y-2">
      {stages.map((s, i) => {
        const prev = i ? stages[i - 1]!.value : null;
        const conv = prev ? `${((s.value / prev) * 100).toFixed(prev && s.value / prev < 0.1 ? 1 : 0)}%` : null;
        return (
          <li key={s.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{s.name}{conv ? <span className="ms-2 text-xs font-normal text-muted-fg">{conversionLabel(conv)}</span> : null}</span>
              <span className="font-semibold tabular">{format(s.value)}</span>
            </div>
            <div className="h-6 rounded-[4px] bg-muted" aria-hidden>
              <div className="viz-grow-x h-full rounded-[4px]" style={{ ["--i" as string]: i * 6, width: `${Math.max(1, (s.value / max) * 100)}%`, background: ramp[Math.min(i, 3)] }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
