import { Lock } from "lucide-react";
import { PageFallback } from "@/components/ui/page-fallback";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ForecastChart } from "@/components/charts/forecast-chart";
import { alternates, breadcrumbs, JsonLd } from "@/components/seo/json-ld";
import { Change } from "@/components/price/change";
import { buttonVariants, Card, CardTitle, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { codeOf, findCommodity, getHistory, getLatest, getSeasonal, liveData, slugOf } from "@/lib/api/public";
import { countrySlug, packCommodity, packCountries, packCountry } from "@/lib/countries";
import { env } from "@/lib/env";
import { formatDate, formatMoney, pick } from "@/lib/utils";

type P = PageProps<"/[locale]/[country]/prices/[commodity]">;

/** Prerender every tracked crop of every launched country, from the packs (no API needed at build). */
export function generateStaticParams() {
  return packCountries().flatMap((c) => c.commodityCodes.map((code) => ({ country: countrySlug(c.iso2), commodity: slugOf(code) })));
}

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale, country, commodity } = await params;
  const c = packCountry(country), pc = packCommodity(codeOf(commodity));
  if (!c || !pc || !c.commodityCodes.includes(pc.code)) return {};
  const t = await getTranslations({ locale, namespace: "prices" });
  const vars = { commodity: pick(pc.name, locale), country: pick(c.name, locale), markets: c.markets.length };
  return {
    title: t("commodityTitle", vars),
    description: t("commodityDescription", vars),
    alternates: alternates(`/${country}/prices/${commodity}`, locale),
    openGraph: { title: t("commodityTitle", vars), description: t("commodityDescription", vars), type: "website" },
  };
}

async function LiveSection({ cc, slug, locale, countryName, commodityName }: { cc: string; slug: string; locale: string; countryName: string; commodityName: string }) {
  const t = await getTranslations({ locale, namespace: "prices" });
  const tn = await getTranslations({ locale, namespace: "nav" });
  await liveData();
  const commodity = await findCommodity(cc, slug, locale);
  if (!commodity) return <p className="text-muted-fg">{t("unavailable")}</p>;
  const [latest, history, seasonal] = await Promise.all([getLatest(commodity.id, cc), getHistory(commodity.id, cc, "6M"), getSeasonal(commodity.id, cc, locale)]);
  const unit = history?.unit ?? latest?.[0]?.value.display.unit ?? "kg";
  const currency = history?.currency ?? latest?.[0]?.value.display.currency ?? "";
  const lastUpdated = latest?.reduce<string | null>((m, l) => (!m || l.observedAt > m ? l.observedAt : m), null);

  const dataset = {
    "@context": "https://schema.org", "@type": "Dataset",
    name: t("commodityTitle", { commodity: commodityName, country: countryName }),
    description: t("commodityDescription", { commodity: commodityName, country: countryName, markets: latest?.length ?? 0 }),
    url: `${env.siteUrl}/${locale}/${countrySlug(cc)}/prices/${slug}`,
    creator: { "@type": "Organization", name: "AgriPrice" },
    spatialCoverage: { "@type": "Place", name: countryName },
    temporalCoverage: history?.points.length ? `${history.points[0]!.t.slice(0, 10)}/${history.points[history.points.length - 1]!.t.slice(0, 10)}` : undefined,
    variableMeasured: `${commodityName} price (${currency}/${unit})`,
    dateModified: lastUpdated ?? undefined,
    isAccessibleForFree: true,
  };

  return (
    <>
      <JsonLd data={dataset} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-baseline justify-between"><CardTitle>{t("sixMonths")}</CardTitle><span className="text-xs text-muted-fg">{currency}/{unit}</span></div>
          {history?.points.length ? (
            <ForecastChart history={history.points} currency={currency} unit={unit} locale={locale} labels={{ historical: t("sixMonths"), forecast: "", range: "" }} />
          ) : <p className="py-12 text-center text-muted-fg">{t("noData")}</p>}
          {history?.stats ? (
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {([["average", history.stats.average], ["high", history.stats.high], ["low", history.stats.low]] as const).map(([k, v]) => (
                <div key={k}><dt className="text-muted-fg">{t(k)}</dt><dd className="font-semibold tabular">{v ? formatMoney(v, currency, locale) : "—"}</dd></div>
              ))}
              <div><dt className="text-muted-fg">{t("volatility")}</dt><dd className="font-semibold capitalize">{(history.stats.volatility.label ?? "insufficient_data").replace("_", " ")}</dd></div>
            </dl>
          ) : null}
        </Card>
        <div className="space-y-6">
          {seasonal?.insight ? <Card className="bg-info"><CardTitle>{t("seasonal")}</CardTitle><p className="mt-2 text-sm">{seasonal.insight}</p></Card> : null}
          <Card className="space-y-3">
            <Lock aria-hidden className="size-6 text-forecast" />
            <p className="text-sm">{t("forecastLocked")}</p>
            <Link href={`/login?next=${encodeURIComponent(`/${locale}/app/forecast/${commodity.id}`)}`} className={buttonVariants({ size: "sm" })}>{tn("signIn")}</Link>
          </Card>
        </div>
      </div>

      <Card className="mt-6 overflow-x-auto p-0">
        <h2 className="px-4 pt-4 text-base font-semibold">{t("latestByMarket")}</h2>
        {latest?.length ? (
          <table className="mt-2 w-full min-w-[32rem] text-sm">
            <thead className="bg-muted text-muted-fg"><tr><th scope="col" className="px-4 py-2 text-start">{t("market")}</th><th scope="col" className="px-4 py-2 text-end">{t("price")}</th><th scope="col" className="px-4 py-2 text-end">{t("change")}</th><th scope="col" className="px-4 py-2 text-end">{t("updated")}</th></tr></thead>
            <tbody>
              {latest.map((l) => (
                <tr key={l.marketId} className="border-t border-border">
                  <th scope="row" className="px-4 py-3 text-start font-medium">{pick(l.marketName, locale)}</th>
                  <td className="px-4 py-3 text-end tabular">{formatMoney(l.value.display.amount, l.value.display.currency, locale)}/{l.value.display.unit}</td>
                  <td className="px-4 py-3 text-end"><Change pct={l.changePctWoW} /></td>
                  <td className="px-4 py-3 text-end text-muted-fg">{formatDate(l.observedAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="p-4 text-muted-fg">{t("noData")}</p>}
      </Card>
    </>
  );
}

async function CommodityPricePageBody({ params }: Pick<P, "params">) {
  const { locale, country, commodity } = await params;
  setRequestLocale(locale);
  const c = packCountry(country), pc = packCommodity(codeOf(commodity));
  if (!c || !pc || !c.commodityCodes.includes(pc.code)) notFound();
  const t = await getTranslations("prices");
  const countryName = pick(c.name, locale), commodityName = pick(pc.name, locale);
  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <JsonLd data={breadcrumbs([
        { name: "AgriPrice", url: `/${locale}` },
        { name: t("indexTitle", { country: countryName }), url: `/${locale}/${country}/prices` },
        { name: commodityName, url: `/${locale}/${country}/prices/${commodity}` },
      ], env.siteUrl)} />
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-fg"><Link href={`/${country}/prices`} className="hover:text-brand">{t("indexTitle", { country: countryName })}</Link> / {commodityName}</nav>
      <h1 className="text-3xl font-bold">{t("commodityTitle", { commodity: commodityName, country: countryName })}</h1>
      <p className="mt-2 mb-8 max-w-3xl text-muted-fg">{t("commodityDescription", { commodity: commodityName, country: countryName, markets: c.markets.length })}</p>
      <Suspense fallback={<div className="grid gap-6 lg:grid-cols-3"><Skeleton className="h-80 lg:col-span-2" /><Skeleton className="h-40" /></div>}>
        <LiveSection cc={c.iso2} slug={commodity} locale={locale} countryName={countryName} commodityName={commodityName} />
      </Suspense>
    </div>
  );
}

/** Params are read inside Suspense so the shared shell stays instant; generateStaticParams still prerenders the content. */
export default function CommodityPricePage({ params }: P) {
  return <Suspense fallback={<PageFallback />}><CommodityPricePageBody params={params} /></Suspense>;
}
