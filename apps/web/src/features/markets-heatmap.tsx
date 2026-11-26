"use client";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsNumberLiteral, useQueryState } from "nuqs";
import { EmptyState } from "@/components/agri/empty-state";
import { PriceCell } from "@/components/agri/price-cell";
import { RangeTabs } from "@/components/agri/range-tabs";
import { RegionHeatmap, type RegionFeature } from "@/components/agri/region-heatmap";
import { Card, CardTitle, Skeleton } from "@/components/ui/primitives";
import { useChoropleth, useMe, useRegionsGeo } from "@/lib/api/queries";
import { number, pctPlain } from "@/lib/format";
import { pick } from "@/lib/utils";
import { PageTitle, QueryState } from "./common";
import { CommodityPicker, useCommodityChoice } from "./markets-nav";

const DAYS = [7, 30, 90] as const;

type RegionRow = { regionId: string; code: string; name?: Record<string, string>; avg?: string | null; observations: number; marketCount?: number };

/** Regions with an average, sorted low → high; the extremes and the relative gap between them. */
export function rankRegions(regions: RegionRow[]) {
  const rows = regions.filter((r) => r.avg != null && Number.isFinite(Number(r.avg))).sort((a, b) => Number(a.avg) - Number(b.avg));
  const lo = rows[0], hi = rows.at(-1);
  const spreadPct = lo && hi && rows.length > 1 && Number(lo.avg) > 0 ? ((Number(hi.avg) - Number(lo.avg)) / Number(lo.avg)) * 100 : null;
  return { rows, cheapest: rows.slice(0, 3), priciest: rows.slice(-3).reverse(), spreadPct };
}

/** /app/markets/heatmap (mockup: Regional heatmap): average price per region over 7/30/90 days. */
export function MarketsHeatmapView() {
  const t = useTranslations("mkt");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const choice = useCommodityChoice(cc);
  const [days, setDays] = useQueryState("days", parseAsNumberLiteral(DAYS).withDefault(30));
  const geo = useRegionsGeo(cc);
  const ch = useChoropleth(cc, choice.id, days);
  const name = pick(choice.list.find((c) => c.id === choice.id)?.name, locale);

  return (
    <div className="space-y-5">
      <PageTitle title={t("heatTitle")} subtitle={name ? `${name} · ${t("lastDays", { n: days })}` : undefined} />
      <div className="flex flex-wrap items-end gap-3">
        <CommodityPicker choice={choice} />
        <div className="flex flex-col gap-1 text-xs font-medium text-muted-fg">
          <span aria-hidden>{t("days")}</span>
          <RangeTabs label={t("days")} value={String(days) as `${(typeof DAYS)[number]}`} onChange={(v) => setDays(Number(v) === 30 ? null : (Number(v) as (typeof DAYS)[number]))}
            options={DAYS.map((d) => ({ value: String(d) as `${typeof d}`, label: t("lastDays", { n: d }) }))} />
        </div>
      </div>
      <QueryState q={ch} skeleton={<Skeleton className="h-[480px]" />}>
        {(c) => {
          const { rows, cheapest, priciest, spreadPct } = rankRegions(c.regions);
          if (!rows.length) return <EmptyState title={t("noRegionData")} />;
          const list = (items: RegionRow[], icon: typeof ArrowDown, cls: string) => {
            const Icon = icon;
            return (
              <ol className="mt-2 space-y-1.5 text-sm">
                {items.map((r) => (
                  <li key={r.regionId} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5"><Icon aria-hidden className={`size-4 ${cls}`} />{pick(r.name, locale) || r.code}</span>
                    <PriceCell amount={r.avg} currency={c.currency} unit={c.unit} size="sm" />
                  </li>
                ))}
              </ol>
            );
          };
          return (
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <QueryState q={geo} skeleton={<Skeleton className="h-[420px]" />}>
                  {(g) => <RegionHeatmap geojson={g as unknown as { features: RegionFeature[] }} values={c.regions} currency={c.currency} unit={c.unit} title={`${t("heatTitle")} · ${name}`} />}
                </QueryState>
              </Card>
              <div className="space-y-4">
                <Card><CardTitle>{t("cheapest")}</CardTitle>{list(cheapest, ArrowDown, "text-up")}</Card>
                <Card><CardTitle>{t("priciest")}</CardTitle>{list(priciest, ArrowUp, "text-down")}</Card>
                {spreadPct != null ? (
                  <Card><CardTitle>{t("spread")}</CardTitle><p className="mt-2 text-sm">{t("spreadBody", { pct: pctPlain(spreadPct, locale) })}</p></Card>
                ) : null}
                <p className="text-xs text-muted-fg">{t("regionsWithData", { n: number(rows.length, locale), total: number(c.regions.length, locale) })}</p>
              </div>
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}
