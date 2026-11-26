"use client";
import { BarChart3, ExternalLink, LineChart } from "lucide-react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { parseAsString, useQueryState } from "nuqs";
import { DataFreshness } from "@/components/agri/data-freshness";
import { PriceCell } from "@/components/agri/price-cell";
import { Card, CardTitle, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import type { S } from "@/lib/api/browser";
import { useLatest, useMarkets, useMe } from "@/lib/api/queries";
import { pick } from "@/lib/utils";
import { PageTitle, QueryState } from "./common";
import { CommodityPicker, useCommodityChoice } from "./markets-nav";

// MapLibre is ~200 KB gz: loaded only on the map views, never server-rendered.
export const MarketMap = dynamic(() => import("@/components/agri/market-map").then((m) => m.MarketMap), {
  ssr: false, loading: () => <Skeleton className="h-[420px]" />,
});

const TYPES = ["retail", "wholesale", "farm_gate", "rural_periodic", "urban_daily", "border", "export_hub"] as const;
// Same rules as lib/countries (server-only): ISO2 lower-cased; market code with dashes.
export const publicMarketPath = (cc: string, code: string) => `/${cc.toLowerCase()}/markets/${code.replace(/_/g, "-")}`;

/** ISO weekday numbers (1 = Monday) as localised names; 2024-01-01 was a Monday. */
export function weekdayNames(days: number[] | undefined, locale: string) {
  return (days ?? []).filter((d) => d >= 1 && d <= 7).sort().map((d) => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(Date.UTC(2024, 0, d)));
}

/** /app/markets/map (mockup: Market map). Pins from the market list, prices joined from the latest reports. */
export function MarketsMapView() {
  const t = useTranslations("mkt");
  const tp = useTranslations("pub");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const choice = useCommodityChoice(cc, { optional: true });
  const markets = useMarkets(cc);
  const latest = useLatest(choice.id, cc);
  const [type, setType] = useQueryState("type", parseAsString);
  const [selected, setSelected] = useQueryState("m", parseAsString);

  const priceBy = new Map((latest.data ?? []).map((l) => [l.marketId, l]));
  const all = markets.data?.data ?? [];
  const shown = all.filter((m) => !type || m.type === type);
  const commodityName = pick(choice.list.find((c) => c.id === choice.id)?.name, locale);
  const withPrice = shown.filter((m) => priceBy.has(m.id)).length;
  const current = all.find((m) => m.id === selected);

  return (
    <div className="space-y-5">
      <PageTitle title={t("mapTitle")} subtitle={markets.isSuccess ? `${t("shown", { n: shown.length })}${choice.id ? ` · ${t("withPrice", { n: withPrice, commodity: commodityName })}` : ""}` : undefined} />
      <div className="flex flex-wrap items-end gap-3">
        <CommodityPicker choice={choice} optional />
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-fg">
          {t("marketType")}
          <select value={type ?? ""} onChange={(e) => setType(e.target.value || null)} className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground">
            <option value="">{t("allTypes")}</option>
            {TYPES.filter((ty) => all.some((m) => m.type === ty)).map((ty) => <option key={ty} value={ty}>{tp(`type_${ty}`)}</option>)}
          </select>
        </label>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <QueryState q={markets} skeleton={<Skeleton className="h-[420px]" />}>
            {() => (
              <MarketMap selectedId={selected} onSelect={(id) => setSelected(id)} markets={shown.map((m) => {
                const p = priceBy.get(m.id);
                return { id: m.id, name: m.name, location: m.location, price: p ? { amount: p.value.display.amount, currency: p.value.display.currency, unit: p.value.display.unit } : null };
              })} />
            )}
          </QueryState>
        </div>
        <Card className="h-fit space-y-4 lg:sticky lg:top-4">
          {current ? <MarketPanel market={current} cc={cc} price={priceBy.get(current.id)} commodityId={choice.id} commodityName={commodityName} /> : <p className="text-sm text-muted-fg">{t("pickOnMap")}</p>}
        </Card>
      </div>
    </div>
  );
}

function MarketPanel({ market, cc, price, commodityId, commodityName }: { market: S["Market"]; cc: string; price?: S["MarketPrice"]; commodityId: string; commodityName: string }) {
  const t = useTranslations("mkt");
  const tp = useTranslations("pub");
  const locale = useLocale();
  const days = weekdayNames(market.operatingDays, locale);
  return (
    <>
      <div>
        <CardTitle>{pick(market.name, locale)}</CardTitle>
        <dl className="mt-3 divide-y divide-border text-sm">
          {([[t("region"), pick(market.regionName, locale) || null], [t("type"), tp(`type_${market.type}`)], [t("operatingDays"), days.length === 7 ? t("everyDay") : days.join(", ") || null]] as const)
            .filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-muted-fg">{k}</dt><dd className="text-end font-medium">{v}</dd></div>)}
        </dl>
      </div>
      {commodityId ? (
        <div className="rounded-xl bg-muted/60 p-3">
          <p className="text-xs text-muted-fg">{t("latestPrice")} · {commodityName}</p>
          {price ? (<><PriceCell amount={price.value.display.amount} currency={price.value.display.currency} unit={price.value.display.unit} size="lg" /><DataFreshness at={price.observedAt} className="mt-1" /></>)
            : <p className="mt-1 text-sm text-muted-fg">{t("noPriceHere")}</p>}
        </div>
      ) : null}
      <ul className="space-y-2 text-sm font-semibold text-brand">
        <li><Link href={publicMarketPath(cc, market.code)} className="inline-flex items-center gap-1.5 hover:underline"><ExternalLink aria-hidden className="size-4" />{t("publicPage")}</Link></li>
        {commodityId ? <li><Link href={`/app/markets?commodity=${commodityId}`} className="inline-flex items-center gap-1.5 hover:underline"><BarChart3 aria-hidden className="size-4" />{t("compareHere")}</Link></li> : null}
        {commodityId ? <li><Link href={`/app/forecast/${commodityId}?market=${market.id}`} className="inline-flex items-center gap-1.5 hover:underline"><LineChart aria-hidden className="size-4" />{t("forecastHere")}</Link></li> : null}
      </ul>
    </>
  );
}
