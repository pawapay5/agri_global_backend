"use client";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { money, pct, unitLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const monthName = (m: number, locale: string, style: "short" | "long" = "short") =>
  new Intl.DateTimeFormat(locale, { month: style, timeZone: "UTC" }).format(Date.UTC(2024, m - 1, 1));

/**
 * Typical price by calendar month (the API's multi-year monthly average). One series, one hue: every bar uses
 * --chart-history; peak and low months are emphasised (full strength vs. muted) AND named in text, so the
 * emphasis never relies on colour. Months with no data are an empty slot, never a zero bar. Table twin included.
 */
export function SeasonalBars({ monthlyAverage, peakMonths, lowMonths, currency, unit, title, height = 180, className }: {
  monthlyAverage: (string | null)[]; peakMonths: number[]; lowMonths: number[]; currency: string; unit: string; title: string; height?: number; className?: string;
}) {
  const t = useTranslations("ds");
  const tc = useTranslations("cmd");
  const locale = useLocale();
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const vals = monthlyAverage.map((v) => (v == null ? null : Number(v)));
  const finite = vals.filter((v): v is number => v != null && Number.isFinite(v));
  if (!finite.length) return <p className={cn("rounded-xl bg-muted p-6 text-center text-sm text-muted-fg", className)}>{t("noSeries")}</p>;
  const max = Math.max(...finite), min = Math.min(...finite);
  // Bars start from a floor below the minimum so month-to-month differences are visible; the axis note says so.
  const floor = Math.max(0, min - (max - min) * 0.6);
  const f = (v: number | null) => (v == null ? "—" : money(v, currency, locale));
  const emphasised = new Set([...peakMonths, ...lowMonths]);

  return (
    <figure className={cn("space-y-3", className)}>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-fg">
        <span>{title}</span><span>{currency}/{unitLabel(unit)}</span>
      </figcaption>
      <div className="relative">
        <ol className="flex items-end gap-1" style={{ height }} aria-label={title}>
          {vals.map((v, i) => {
            const m = i + 1;
            const h = v == null ? 0 : Math.max(4, ((v - floor) / (max - floor || 1)) * (height - 24));
            const label = `${monthName(m, locale, "long")}: ${f(v)}${peakMonths.includes(m) ? `, ${tc("peak")}` : lowMonths.includes(m) ? `, ${tc("low")}` : ""}`;
            return (
              <li key={m} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <button type="button" aria-label={label} onFocus={() => setActive(i)} onBlur={() => setActive(null)} onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)}
                  className="group flex w-full flex-1 items-end justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
                  {v == null ? <span className="mb-0.5 h-1 w-full max-w-6 rounded-full bg-[var(--chart-grid)]" /> : (
                    <span className={cn("w-full max-w-6 rounded-t-[4px] bg-[var(--chart-history)] transition-opacity", emphasised.size && !emphasised.has(m) && "opacity-45", active === i && "opacity-100 brightness-110")} style={{ height: h }} />
                  )}
                </button>
                <span className={cn("text-[11px] text-muted-fg", emphasised.has(m) && "font-semibold text-foreground")}>{monthName(m, locale)}</span>
              </li>
            );
          })}
        </ol>
        {active != null ? (
          <div role="presentation" className="pointer-events-none absolute -top-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-md" style={{ insetInlineStart: `${Math.min(80, (active / 12) * 100)}%` }}>
            <span className="font-semibold tabular">{f(vals[active] ?? null)}</span> <span className="text-muted-fg">{monthName(active + 1, locale, "long")}</span>
          </div>
        ) : null}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {peakMonths.length ? <li className="flex items-center gap-1"><ArrowUp aria-hidden className="size-4 text-down" />{tc("peakMonths", { months: peakMonths.map((m) => monthName(m, locale, "long")).join(", ") })}</li> : null}
        {lowMonths.length ? <li className="flex items-center gap-1"><ArrowDown aria-hidden className="size-4 text-up" />{tc("lowMonths", { months: lowMonths.map((m) => monthName(m, locale, "long")).join(", ") })}</li> : null}
      </ul>
      <button type="button" onClick={() => setShowTable((s) => !s)} aria-expanded={showTable} aria-controls={`${id}-t`} className="text-xs font-semibold text-brand hover:underline">
        {showTable ? t("hideTable") : t("viewTable")}
      </button>
      <div id={`${id}-t`} hidden={!showTable} className="overflow-x-auto rounded-xl border border-border" tabIndex={showTable ? 0 : -1} role="region" aria-label={title}>
        <table className="w-full text-sm">
          <caption className="sr-only">{title}</caption>
          <thead className="bg-muted text-muted-fg"><tr><th scope="col" className="px-3 py-2 text-start font-medium">{tc("month")}</th><th scope="col" className="px-3 py-2 text-end font-medium">{tc("typicalPrice")}</th></tr></thead>
          <tbody>{vals.map((v, i) => <tr key={i} className="border-t border-border"><th scope="row" className="px-3 py-1.5 text-start font-normal">{monthName(i + 1, locale, "long")}</th><td className="px-3 py-1.5 text-end tabular">{f(v)}</td></tr>)}</tbody>
        </table>
      </div>
    </figure>
  );
}

/** Average month-on-month change, for a sentence like "prices usually rise 12% in May" (exported for tests). */
export function biggestMonthlyMove(avgMonthlyChangePct: (number | null)[]) {
  let best: { month: number; pct: number } | null = null;
  avgMonthlyChangePct.forEach((v, i) => { if (v != null && Number.isFinite(v) && (!best || Math.abs(v) > Math.abs(best.pct))) best = { month: i + 1, pct: v }; });
  return best as { month: number; pct: number } | null;
}

export { monthName, pct as formatPct };
