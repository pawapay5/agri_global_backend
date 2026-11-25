"use client";
import { useLocale, useTranslations } from "next-intl";
import type { ChartRow } from "@/lib/charts";
import { money, shortDate, unitLabel } from "@/lib/format";

/** The table twin of a time-series chart: every value the chart draws, reachable without hover. */
export function ChartTable({ caption, rows, currency, unit }: { caption: string; rows: ChartRow[]; currency: string; unit: string }) {
  const t = useTranslations("ds");
  const locale = useLocale();
  const hasForecast = rows.some((r) => r.p50 != null && r.actual == null);
  const f = (v: number | undefined) => (v == null ? "—" : money(v, currency, locale));
  return (
    <div className="max-h-80 overflow-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption} ({currency}/{unitLabel(unit)})</caption>
        <thead className="sticky top-0 bg-muted text-muted-fg">
          <tr>
            <th scope="col" className="px-3 py-2 text-start font-medium">{t("date")}</th>
            <th scope="col" className="px-3 py-2 text-end font-medium">{t("actual")}</th>
            {hasForecast ? (
              <>
                <th scope="col" className="px-3 py-2 text-end font-medium">{t("forecast")}</th>
                <th scope="col" className="px-3 py-2 text-end font-medium">P10</th>
                <th scope="col" className="px-3 py-2 text-end font-medium">P90</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isForecast = r.actual == null;
            return (
              <tr key={r.t} className="border-t border-border">
                <th scope="row" className="px-3 py-1.5 text-start font-normal">{shortDate(r.t, locale, { day: "numeric", month: "short", year: "numeric" })}</th>
                <td className="px-3 py-1.5 text-end tabular">{f(r.actual)}</td>
                {hasForecast ? (
                  <>
                    <td className="px-3 py-1.5 text-end tabular">{isForecast ? f(r.p50) : "—"}</td>
                    <td className="px-3 py-1.5 text-end tabular">{isForecast ? f(r.band?.[0]) : "—"}</td>
                    <td className="px-3 py-1.5 text-end tabular">{isForecast ? f(r.band?.[1]) : "—"}</td>
                  </>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
