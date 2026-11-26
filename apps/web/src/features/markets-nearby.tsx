"use client";
import { Navigation } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsNumberLiteral, useQueryState } from "nuqs";
import { DataFreshness } from "@/components/agri/data-freshness";
import { EmptyState } from "@/components/agri/empty-state";
import { PriceCell } from "@/components/agri/price-cell";
import { RangeTabs } from "@/components/agri/range-tabs";
import { Card, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { useMe, useNearby } from "@/lib/api/queries";
import { number } from "@/lib/format";
import { pick } from "@/lib/utils";
import { PageTitle, QueryState } from "./common";
import { LocationPicker, useOrigin } from "./location";
import { MarketMap, publicMarketPath } from "./markets-map";
import { CommodityPicker, useCommodityChoice } from "./markets-nav";

export { coarse } from "./location";

const RADII = [10, 25, 50, 100] as const;

/**
 * /app/markets/nearby (mockup: Nearby markets). The search origin is the user's rounded position or a region's
 * centroid (shared LocationPicker), plus ?r= for the radius; nothing is stored.
 */
export function MarketsNearbyView() {
  const t = useTranslations("mkt");
  const tp = useTranslations("prices");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const choice = useCommodityChoice(cc, { optional: true });
  const origin = useOrigin(cc);
  const [r, setR] = useQueryState("r", parseAsNumberLiteral(RADII).withDefault(50));
  const q = { lat: origin.lat, lng: origin.lng, r };
  const nearby = useNearby({ lat: q.lat, lng: q.lng, radiusKm: q.r, commodityId: choice.id || undefined });

  return (
    <div className="space-y-5">
      <PageTitle title={t("nearbyTitle")} subtitle={origin.label ? t("searchingFrom", { place: origin.label }) : undefined} />
      <Card className="space-y-4">
        <LocationPicker origin={origin} />
        <div className="flex flex-wrap items-end gap-3">
          <CommodityPicker choice={choice} optional />
          <div className="flex flex-col gap-1 text-xs font-medium text-muted-fg">
            <span aria-hidden>{t("radius")}</span>
            <RangeTabs size="sm" label={t("radius")} value={String(q.r) as `${(typeof RADII)[number]}`} onChange={(v) => void setR(Number(v) === 50 ? null : (Number(v) as (typeof RADII)[number]))}
              options={RADII.map((k) => ({ value: String(k) as `${typeof k}`, label: t("km", { n: k }) }))} />
          </div>
        </div>
      </Card>

      {q.lat == null || q.lng == null ? (
        <EmptyState icon={Navigation} title={t("startNearby")} description={t("startNearbyBody")} />
      ) : (
        <QueryState q={nearby} skeleton={<Skeleton className="h-96" />}>
          {(rows) => !rows.length ? <EmptyState title={t("noneNearby", { km: q.r })} /> : (
            <div className="grid gap-6 lg:grid-cols-5">
              <Card className="overflow-x-auto p-0 lg:col-span-3" tabIndex={0} role="region" aria-label={t("nearbyTitle")}>
                <table className="w-full min-w-[30rem] text-sm">
                  <caption className="sr-only">{t("nearbyTitle")}</caption>
                  <thead className="bg-muted text-muted-fg">
                    <tr><th scope="col" className="px-4 py-2 text-start font-medium">{tp("market")}</th><th scope="col" className="px-4 py-2 text-end font-medium">{t("distance")}</th>{choice.id ? <th scope="col" className="px-4 py-2 text-end font-medium">{t("latestPrice")}</th> : null}</tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => (
                      <tr key={m.id} className="border-t border-border align-top">
                        <th scope="row" className="px-4 py-3 text-start font-normal">
                          <Link href={publicMarketPath(cc || m.country, m.code)} className="font-medium hover:text-brand hover:underline">{pick(m.name, locale)}</Link>
                          {pick(m.regionName, locale) ? <span className="block text-xs text-muted-fg">{pick(m.regionName, locale)}</span> : null}
                        </th>
                        <td className="px-4 py-3 text-end tabular">{t("km", { n: number(m.distanceKm, locale, { digits: 1 }) })}</td>
                        {choice.id ? (
                          <td className="px-4 py-3 text-end">
                            {m.latestPrice ? (<><PriceCell amount={m.latestPrice.value.display.amount} currency={m.latestPrice.value.display.currency} unit={m.latestPrice.value.display.unit} size="sm" /><DataFreshness at={m.latestPrice.observedAt} className="justify-end text-xs" /></>)
                              : <span className="text-muted-fg">—</span>}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <div className="lg:col-span-2">
                <MarketMap height={360} markets={rows.map((m) => ({ id: m.id, name: m.name, location: m.location, distanceKm: m.distanceKm,
                  price: m.latestPrice ? { amount: m.latestPrice.value.display.amount, currency: m.latestPrice.value.display.currency, unit: m.latestPrice.value.display.unit } : null }))} />
              </div>
            </div>
          )}
        </QueryState>
      )}
    </div>
  );
}
