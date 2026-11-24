"use client";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildForecastSeries, type HistoryPoint, type HorizonPoint } from "@/lib/charts";
import { formatMoney } from "@/lib/utils";

/**
 * History (solid green) + forecast median (dashed orange) + P10–P90 band (shaded orange).
 * Mirrors the mobile "Price History & Forecast" screen.
 */
export function ForecastChart({ history, horizons, currency, unit, locale, height = 280, labels }: {
  history: HistoryPoint[]; horizons?: HorizonPoint[]; currency: string; unit: string; locale: string; height?: number;
  labels: { historical: string; forecast: string; range: string };
}) {
  const data = buildForecastSeries(history, horizons);
  if (!data.length) return null;
  const fmtDate = (t: number) => new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(t);
  const fmtFull = (t: number) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(t);
  return (
    <figure aria-label={`${labels.historical} / ${labels.forecast} (${currency}/${unit})`}>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={fmtDate} stroke="var(--muted-fg)" fontSize={12} />
          <YAxis stroke="var(--muted-fg)" fontSize={12} width={48} domain={["auto", "auto"]} />
          <Tooltip
            labelFormatter={(t) => fmtFull(Number(t))}
            formatter={(v, name) => (Array.isArray(v) ? [`${formatMoney(v[0], currency, locale)} – ${formatMoney(v[1], currency, locale)}`, labels.range] : [formatMoney(v as number, currency, locale), name])}
            contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }}
          />
          <Area dataKey="band" name={labels.range} stroke="none" fill="var(--forecast)" fillOpacity={0.15} connectNulls isAnimationActive={false} />
          <Line dataKey="actual" name={labels.historical} stroke="var(--leaf)" strokeWidth={2.5} dot={false} connectNulls />
          <Line dataKey="p50" name={labels.forecast} stroke="var(--forecast)" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 3 }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-muted-fg">
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-leaf" />{labels.historical}</span>
        {horizons?.length ? <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-forecast" />{labels.forecast}</span> : null}
        {horizons?.length ? <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded bg-forecast/20" />{labels.range}</span> : null}
      </figcaption>
    </figure>
  );
}
