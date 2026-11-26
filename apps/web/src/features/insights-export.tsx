"use client";
import { ExternalLink, Ship } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsString, useQueryState } from "nuqs";
import { PriceChart } from "@/components/agri/charts/price-chart";
import { EmptyState } from "@/components/agri/empty-state";
import { Badge, Card, CardTitle, Skeleton } from "@/components/ui/primitives";
import type { S } from "@/lib/api/browser";
import { useExportInsights, useMe } from "@/lib/api/queries";
import { pctPlain } from "@/lib/format";
import { pick } from "@/lib/utils";
import { PageTitle, QueryState } from "./common";
import { CommodityPicker, useCommodityChoice } from "./markets-nav";

const safeUrl = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : null);

/**
 * Trend points for one destination as chart history: the API's local-currency figure when it sends one,
 * otherwise USD/kg (and the chart is labelled to match). Exported for tests.
 */
export function exportSeries(x: Pick<S["ExportInsights"], "trend" | "currency">, destination: string | null) {
  const rows = x.trend.filter((p) => !destination || !p.destination || p.destination === destination).sort((a, b) => a.period.localeCompare(b.period));
  const local = rows.length > 0 && rows.every((p) => p.display != null) && Boolean(x.currency);
  return {
    currency: local ? x.currency! : "USD",
    points: rows.map((p) => ({ t: `${p.period}-01`, avg: String(local ? p.display : p.priceUsdPerKg) })),
  };
}

/** /app/insights/export (mockup: Export insights): price trend by destination, premium and requirements. */
export function ExportInsightsView() {
  const t = useTranslations("ins");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const choice = useCommodityChoice(cc);
  const [dest, setDest] = useQueryState("dest", parseAsString);
  const data = useExportInsights(choice.id, cc, dest ?? undefined);
  const name = pick(choice.list.find((c) => c.id === choice.id)?.name, locale);

  return (
    <div className="space-y-5">
      <PageTitle title={t("exportTitle")} subtitle={name || undefined} />
      <div className="flex flex-wrap items-end gap-3">
        <CommodityPicker choice={choice} />
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-fg">{t("destination")}
          <select value={dest ?? ""} onChange={(e) => setDest(e.target.value || null)} className="h-10 min-w-40 rounded-xl border border-border bg-background px-3 text-sm text-foreground">
            <option value="">{t("allDestinations")}</option>
            {[...new Set([...(data.data?.trend ?? []).map((p) => p.destination), ...(data.data?.requirements ?? []).map((r) => r.destination), dest].filter((d): d is string => Boolean(d)))].sort()
              .map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
      </div>
      <QueryState q={data} skeleton={<Skeleton className="h-80" />}>
        {(x) => {
          if (!x.trend.length && !x.requirements.length) return <EmptyState icon={Ship} title={t("noExport")} />;
          const s = exportSeries(x, dest);
          const reqs = [...x.requirements].filter((r) => !dest || r.destination === dest).sort((a, b) => Number(b.mandatory) - Number(a.mandatory));
          return (
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="space-y-3 lg:col-span-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <CardTitle>{t("exportTrend")}</CardTitle>
                  {x.hsCode ? <span className="text-xs text-muted-fg">{t("hsCode", { code: x.hsCode })}</span> : null}
                </div>
                <PriceChart history={s.points} currency={s.currency} unit="kg" title={`${t("exportTrend")} · ${name}${dest ? ` · ${dest}` : ""}`} height={240} />
              </Card>
              <div className="space-y-4">
                {x.premiumOverDomesticPct != null ? (
                  <Card><CardTitle>{t("premium")}</CardTitle><p className="mt-2 text-2xl font-semibold tabular">{pctPlain(x.premiumOverDomesticPct, locale)}</p>
                    <p className="text-sm text-muted-fg">{t("premiumBody", { pct: pctPlain(x.premiumOverDomesticPct, locale) })}</p></Card>
                ) : null}
                <Card className="space-y-3">
                  <CardTitle>{t("requirements")}</CardTitle>
                  {!reqs.length ? <p className="text-sm text-muted-fg">—</p> : (
                    <ul className="space-y-3 text-sm">
                      {reqs.map((r) => (
                        <li key={`${r.destination}-${r.code}`} className="space-y-0.5">
                          <p className="flex flex-wrap items-center gap-2 font-medium">{r.title}<Badge tone={r.mandatory ? "down" : "neutral"}>{r.mandatory ? t("mandatory") : t("optional")}</Badge>{!dest ? <span className="text-xs text-muted-fg">{r.destination}</span> : null}</p>
                          {r.description ? <p className="text-muted-fg">{r.description}</p> : null}
                          {r.authority ? <p className="text-xs text-muted-fg">{t("authority", { name: r.authority })}</p> : null}
                          {safeUrl(r.url) ? <a href={safeUrl(r.url)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">{t("moreInfo")}<ExternalLink aria-hidden className="size-3" /></a> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}
