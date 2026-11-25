"use client";
import { useLocale, useTranslations } from "next-intl";
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { bandPath, linear, linePath, nearestIndex, niceTicks, timeTicks } from "@/lib/chart-scale";
import { buildForecastSeries, type HistoryPoint, type HorizonPoint } from "@/lib/charts";
import { money, shortDate, unitLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChartTable } from "./chart-table";

export interface TimeSeriesChartProps {
  history: HistoryPoint[];
  /** Forecast horizons from the API; omitted or all unavailable = a plain price chart. */
  horizons?: HorizonPoint[];
  currency: string;
  unit: string;
  /** What the series is, for the accessible summary, e.g. "Tomato, Kumasi Central". */
  title: string;
  height?: number;
  /** Position of the "Today" divider (ms). Defaults to now; hidden when outside the plotted range. */
  today?: number;
  className?: string;
}

const M = { top: 20, right: 76, bottom: 28 };

/**
 * Shared SVG engine behind PriceChart and ForecastChart. No chart library: the public price pages ship it.
 * Encoding: history = solid --chart-history line; forecast = dashed --chart-forecast line + P10–P90 band;
 * identity never relies on colour alone (dash pattern, "Today" divider, legend, direct label).
 */
export function TimeSeriesChart({ history, horizons, currency, unit, title, height = 280, today: todayProp, className }: TimeSeriesChartProps) {
  // Read the clock once per mount, not on every render.
  const [mountedAt] = useState(() => Date.now());
  const today = todayProp ?? mountedAt;
  const t = useTranslations("ds");
  const locale = useLocale();
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = useMemo(() => buildForecastSeries(history, horizons), [history, horizons]);
  const hasForecast = rows.some((r) => r.p50 != null && r.actual == null);
  const fmt = (v: number | undefined) => (v == null ? "—" : money(v, currency, locale));
  const fmtAxis = (v: number) => money(v, currency, locale, { compact: v >= 10_000 });

  const geo = useMemo(() => {
    if (rows.length < 2) return null;
    const values = rows.flatMap((r) => [r.actual, r.p50, ...(r.band ?? [])]).filter((v): v is number => v != null && Number.isFinite(v));
    const { ticks: yTicks, domain } = niceTicks(Math.min(...values), Math.max(...values), 5);
    const left = Math.min(96, 12 + Math.max(...yTicks.map((v) => fmtAxis(v).length)) * 7);
    const x = linear([rows[0]!.t, rows[rows.length - 1]!.t], [left, width - M.right]);
    const y = linear(domain, [height - M.bottom, M.top]);
    const xs = rows.map((r) => x(r.t));
    return {
      left, x, y, xs, yTicks,
      xTicks: timeTicks(rows[0]!.t, rows[rows.length - 1]!.t, width < 480 ? 3 : 5),
      actual: linePath(rows.map((r) => ({ x: x(r.t), y: r.actual == null ? null : y(r.actual) }))),
      forecast: linePath(rows.map((r) => ({ x: x(r.t), y: r.p50 == null ? null : y(r.p50) }))),
      band: bandPath(rows.filter((r) => r.band).map((r) => ({ x: x(r.t), lo: y(r.band![0]), hi: y(r.band![1]) }))),
    };
    // fmtAxis depends only on currency/locale, already listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, width, height, currency, locale]);

  const actuals = rows.filter((r) => r.actual != null);
  const lastActual = actuals[actuals.length - 1];
  const lastForecast = hasForecast ? rows[rows.length - 1] : undefined;
  const span = { start: rows[0] ? shortDate(rows[0].t, locale, { day: "numeric", month: "short", year: "numeric" }) : "", end: lastActual ? shortDate(lastActual.t, locale, { day: "numeric", month: "short", year: "numeric" }) : "" };
  const vals = actuals.map((r) => r.actual!);
  const summary = actuals.length
    ? t("summary", { series: title, start: span.start, end: span.end, low: fmt(Math.min(...vals)), high: fmt(Math.max(...vals)), latest: fmt(lastActual?.actual) }) +
      (lastForecast?.p50 != null ? " " + t("forecastSummary", { end: shortDate(lastForecast.t, locale, { month: "long", year: "numeric" }), p50: fmt(lastForecast.p50), p10: fmt(lastForecast.band?.[0]), p90: fmt(lastForecast.band?.[1]) }) : "")
    : t("noSeries");

  if (!geo) {
    return <p className={cn("rounded-xl bg-muted p-6 text-center text-sm text-muted-fg", className)}>{t("noSeries")}</p>;
  }

  const row = active == null ? null : rows[active];
  const pick = (px: number) => setActive(nearestIndex(geo.xs, px));
  const onPointer = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    pick(((e.clientX - box.left) / box.width) * width);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const last = rows.length - 1;
    const next = e.key === "ArrowRight" ? Math.min(last, (active ?? -1) + 1)
      : e.key === "ArrowLeft" ? Math.max(0, (active ?? last + 1) - 1)
      : e.key === "Home" ? 0 : e.key === "End" ? last : e.key === "Escape" ? null : undefined;
    if (next === undefined) return;
    e.preventDefault();
    setActive(next);
  };
  const todayX = today >= rows[0]!.t && today <= rows[rows.length - 1]!.t ? geo.x(today) : null;
  const tipLeft = row ? Math.min(Math.max(geo.x(row.t) / width, 0.12), 0.78) * 100 : 0;
  const readout = row
    ? [shortDate(row.t, locale, { day: "numeric", month: "short", year: "numeric" }),
      row.actual != null ? `${t("actual")} ${fmt(row.actual)}` : null,
      row.p50 != null && row.actual == null ? `${t("forecast")} ${fmt(row.p50)}` : null,
      row.band && row.actual == null ? `${t("range")} ${fmt(row.band[0])} – ${fmt(row.band[1])}` : null].filter(Boolean).join(", ")
    : "";

  return (
    <figure className={cn("space-y-3", className)}>
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-fg">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Legend">
          <li className="flex items-center gap-1.5"><svg width="18" height="8" aria-hidden><line x1="1" x2="17" y1="4" y2="4" stroke="var(--chart-history)" strokeWidth="2" strokeLinecap="round" /></svg>{t("actual")}</li>
          {hasForecast ? (
            <>
              <li className="flex items-center gap-1.5"><svg width="18" height="8" aria-hidden><line x1="1" x2="17" y1="4" y2="4" stroke="var(--chart-forecast)" strokeWidth="2" strokeDasharray="5 3" strokeLinecap="round" /></svg>{t("forecast")}</li>
              <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-2.5 w-4 rounded-sm" style={{ background: "var(--chart-band)" }} />{t("range")}</li>
            </>
          ) : null}
        </ul>
        <span>{currency}/{unitLabel(unit)}</span>
      </figcaption>

      <div ref={wrap} className="relative">
        <svg
          width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="group" tabIndex={0}
          aria-label={title} aria-describedby={`${id}-summary`} onKeyDown={onKey} onBlur={() => setActive(null)}
          className="block overflow-visible rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ring)] forced-colors:[&_*]:[stroke:CanvasText]"
        >
          {geo.yTicks.map((v) => (
            <g key={v}>
              <line x1={geo.left} x2={width - M.right} y1={geo.y(v)} y2={geo.y(v)} stroke="var(--chart-grid)" strokeWidth="1" />
              <text x={geo.left - 8} y={geo.y(v)} dy="0.32em" textAnchor="end" className="fill-[var(--chart-axis)] text-[11px] tabular">{fmtAxis(v)}</text>
            </g>
          ))}
          {geo.xTicks.map((tt) => (
            <text key={tt} x={geo.x(tt)} y={height - 8} textAnchor="middle" className="fill-[var(--chart-axis)] text-[11px]">{shortDate(tt, locale)}</text>
          ))}

          {geo.band ? <path d={geo.band} fill="var(--chart-band)" stroke="none" /> : null}
          {todayX != null ? (
            <g aria-hidden>
              <line x1={todayX} x2={todayX} y1={M.top - 6} y2={height - M.bottom} stroke="var(--chart-today)" strokeWidth="1" />
              <text x={todayX} y={M.top - 9} textAnchor="middle" className="fill-[var(--chart-axis)] text-[11px] font-medium">{t("today")}</text>
            </g>
          ) : null}
          <path d={geo.actual} fill="none" stroke="var(--chart-history)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {hasForecast ? <path d={geo.forecast} fill="none" stroke="var(--chart-forecast)" strokeWidth="2" strokeDasharray="6 4" strokeLinejoin="round" strokeLinecap="round" /> : null}

          {lastActual ? <Dot x={geo.x(lastActual.t)} y={geo.y(lastActual.actual!)} color="var(--chart-history)" /> : null}
          {lastForecast?.p50 != null ? (
            <>
              <Dot x={geo.x(lastForecast.t)} y={geo.y(lastForecast.p50)} color="var(--chart-forecast)" />
              {/* Direct label: the forecast orange is < 3:1 on white, so the line is always named in text ink. */}
              <text x={geo.x(lastForecast.t) + 8} y={geo.y(lastForecast.p50)} dy="0.32em" className="fill-[var(--foreground)] text-[11px] font-semibold tabular">{fmt(lastForecast.p50)}</text>
              <text x={geo.x(lastForecast.t) + 8} y={geo.y(lastForecast.p50) + 13} dy="0.32em" className="fill-[var(--chart-axis)] text-[10px]">{t("forecast")}</text>
            </>
          ) : lastActual ? (
            <text x={geo.x(lastActual.t) + 8} y={geo.y(lastActual.actual!)} dy="0.32em" className="fill-[var(--foreground)] text-[11px] font-semibold tabular">{fmt(lastActual.actual)}</text>
          ) : null}

          {row ? (
            <g aria-hidden>
              <line x1={geo.x(row.t)} x2={geo.x(row.t)} y1={M.top} y2={height - M.bottom} stroke="var(--chart-axis)" strokeWidth="1" />
              {row.actual != null ? <Dot x={geo.x(row.t)} y={geo.y(row.actual)} color="var(--chart-history)" /> : null}
              {row.p50 != null && row.actual == null ? <Dot x={geo.x(row.t)} y={geo.y(row.p50)} color="var(--chart-forecast)" /> : null}
            </g>
          ) : null}
          {/* Hit layer: the whole plot, so readers aim at a date, not a 2px line. */}
          <rect x={geo.left} y={M.top} width={Math.max(0, width - M.right - geo.left)} height={height - M.top - M.bottom} fill="transparent"
            onPointerMove={onPointer} onPointerDown={onPointer} onPointerLeave={() => setActive(null)} />
        </svg>

        {row ? (
          <div role="presentation" className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md" style={{ left: `${tipLeft}%` }}>
            <p className="text-muted-fg">{shortDate(row.t, locale, { day: "numeric", month: "short", year: "numeric" })}</p>
            {row.actual != null ? <TipRow dash={false} color="var(--chart-history)" value={fmt(row.actual)} label={t("actual")} /> : null}
            {row.p50 != null && row.actual == null ? <TipRow dash color="var(--chart-forecast)" value={fmt(row.p50)} label={t("forecast")} /> : null}
            {row.band && row.actual == null ? <p className="mt-0.5 text-muted-fg tabular">{fmt(row.band[0])} – {fmt(row.band[1])}</p> : null}
          </div>
        ) : null}
        <p id={`${id}-summary`} className="sr-only">{summary}</p>
        <p className="sr-only" aria-live="polite">{readout}</p>
      </div>

      <button type="button" onClick={() => setShowTable((s) => !s)} aria-expanded={showTable} aria-controls={`${id}-table`}
        className="text-xs font-semibold text-brand underline-offset-4 hover:underline">
        {showTable ? t("hideTable") : t("viewTable")}
      </button>
      <div id={`${id}-table`} hidden={!showTable}>
        <ChartTable caption={title} rows={rows} currency={currency} unit={unit} />
      </div>
    </figure>
  );
}

/** End/hover marker: r=4 filled, with a 2px ring in the surface colour so it stays legible over lines. */
function Dot({ x, y, color }: { x: number; y: number; color: string }) {
  return <circle cx={x} cy={y} r={4} fill={color} stroke="var(--chart-surface)" strokeWidth={2} />;
}

function TipRow({ color, dash, value, label }: { color: string; dash: boolean; value: string; label: string }) {
  return (
    <p className="mt-1 flex items-center gap-2">
      <svg width="12" height="6" aria-hidden><line x1="0" x2="12" y1="3" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dash ? "4 2" : undefined} /></svg>
      <span className="font-semibold text-foreground tabular">{value}</span>
      <span className="text-muted-fg">{label}</span>
    </p>
  );
}
