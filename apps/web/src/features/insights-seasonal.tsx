"use client";
import { useLocale, useTranslations } from "next-intl";
import { parseAsString, useQueryState } from "nuqs";
import { EmptyState } from "@/components/agri/empty-state";
import { biggestMonthlyMove, monthName, SeasonalBars } from "@/components/agri/seasonal-bars";
import { Card, CardTitle, Skeleton } from "@/components/ui/primitives";
import { useMe, useSeasonal } from "@/lib/api/queries";
import { number, pctPlain, unitLabel } from "@/lib/format";
import { pick } from "@/lib/utils";
import { PageTitle, QueryState } from "./common";
import { MarketSelect } from "./forecast";
import { CommodityPicker, useCommodityChoice } from "./markets-nav";

/** /app/insights/seasonal (mockup: Seasonal insights): monthly pattern, the biggest usual move, and each year's months. */
export function SeasonalInsights() {
  const t = useTranslations("ins");
  const tc = useTranslations("cmd");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const choice = useCommodityChoice(cc);
  const [market] = useQueryState("market", parseAsString);
  const seasonal = useSeasonal(choice.id, cc, market ?? undefined);
  const name = pick(choice.list.find((c) => c.id === choice.id)?.name, locale);

  return (
    <div className="space-y-5">
      <PageTitle title={t("seasonalTitle")} subtitle={name || undefined} />
      <div className="flex flex-wrap items-end gap-3">
        <CommodityPicker choice={choice} />
        <MarketSelect cc={cc} allLabel={tc("allMarkets")} />
      </div>
      <QueryState q={seasonal} skeleton={<Skeleton className="h-72" />}>
        {(a) => {
          const has = a.monthlyAverage.some((v) => v != null && Number.isFinite(Number(v)));
          if (!has) return <EmptyState title={t("noSeasonal")} />;
          const move = biggestMonthlyMove(a.avgMonthlyChangePct);
          const years = [...a.years].sort((x, y) => y.year - x.year);
          return (
            <div className="space-y-6">
              <Card className="space-y-3">
                <SeasonalBars monthlyAverage={a.monthlyAverage} peakMonths={a.peakMonths} lowMonths={a.lowMonths} currency={a.currency} unit={a.unit} title={`${tc("seasonalTitle")} · ${name}`} height={220} />
                {a.insight ? <p className="text-sm">{a.insight}</p> : move ? (
                  <p className="text-sm">{tc("biggestMove", { dir: move.pct >= 0 ? tc("rise") : tc("fall"), pct: pctPlain(move.pct, locale), month: monthName(move.month, locale, "long") })}</p>
                ) : null}
              </Card>
              {years.length ? (
                <Card className="space-y-3 p-0">
                  <div className="flex items-baseline justify-between px-5 pt-5"><CardTitle>{t("byYear")}</CardTitle><span className="text-xs text-muted-fg">{a.currency}/{unitLabel(a.unit)}</span></div>
                  <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("byYear")}>
                    <table className="w-full min-w-[56rem] text-sm">
                      <caption className="sr-only">{t("byYear")} · {name} ({a.currency}/{unitLabel(a.unit)})</caption>
                      <thead className="bg-muted text-muted-fg">
                        <tr><th scope="col" className="px-3 py-2 text-start font-medium">{t("yearCol")}</th>
                          {Array.from({ length: 12 }, (_, i) => <th key={i} scope="col" className="px-2 py-2 text-end font-medium">{monthName(i + 1, locale)}</th>)}</tr>
                      </thead>
                      <tbody>
                        {years.map((y) => (
                          <tr key={y.year} className="border-t border-border">
                            <th scope="row" className="px-3 py-2 text-start font-medium">{y.year}</th>
                            {y.months.map((v, i) => (
                              <td key={i} className={`px-2 py-2 text-end tabular ${a.peakMonths.includes(i + 1) ? "font-semibold" : ""}`}>{v == null ? "—" : number(Number(v), locale, { digits: 2 })}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              ) : null}
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}
