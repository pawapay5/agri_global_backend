import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PriceCell } from "@/components/agri/price-cell";
import { PageHeader } from "@/components/content/page-header";
import { alternates, breadcrumbs, JsonLd } from "@/components/seo/json-ld";
import { PageFallback } from "@/components/ui/page-fallback";
import { Card, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { getChoropleth, getCommodities, liveData, slugOf } from "@/lib/api/public";
import { countrySlug, marketSlug, packCountries, packCountry, packMarkets, packRegion, packRegions, regionSlug } from "@/lib/countries";
import { env } from "@/lib/env";
import { number } from "@/lib/format";
import { pick } from "@/lib/utils";

type P = PageProps<"/[locale]/[country]/regions/[region]">;

export function generateStaticParams() {
  return packCountries().flatMap((c) => packRegions(c.iso2).map((r) => ({ country: countrySlug(c.iso2), region: regionSlug(r.code) })));
}

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale, country, region } = await params;
  const c = packCountry(country), r = c && packRegion(c.iso2, region);
  if (!c || !r) return {};
  const t = await getTranslations({ locale, namespace: "pub" });
  const vars = { region: pick(r.name, locale), country: pick(c.name, locale), count: c.commodityCodes.length };
  return { title: t("regionTitle", vars), description: t("regionDescription", vars), alternates: alternates(`/${country}/regions/${region}`, locale) };
}

/** 30-day average per tracked crop in this region, from each crop's (cached) choropleth. */
async function Averages({ cc, regionCode, locale }: { cc: string; regionCode: string; locale: string }) {
  await liveData();
  const t = await getTranslations({ locale, namespace: "pub" });
  const tp = await getTranslations({ locale, namespace: "prices" });
  const commodities = await getCommodities(cc, locale);
  if (!commodities) return <p className="text-muted-fg">{t("unavailable")}</p>;
  const tracked = packCountries().find((c) => c.iso2 === cc)?.commodityCodes ?? [];
  const rows = (await Promise.all(tracked.map(async (code) => {
    const commodity = commodities.find((x) => x.code === code);
    if (!commodity) return null;
    const ch = await getChoropleth(commodity.id, cc);
    const here = ch?.regions.find((r) => r.code === regionCode);
    return here?.avg ? { code, name: pick(commodity.name, locale), avg: here.avg, n: here.observations, currency: ch!.currency, unit: ch!.unit } : null;
  }))).filter((r): r is NonNullable<typeof r> => r !== null);
  if (!rows.length) return <p className="rounded-xl bg-muted p-6 text-center text-sm text-muted-fg">{t("noRegionData")}</p>;
  return (
    <Card className="overflow-x-auto p-0" tabIndex={0} role="region" aria-label={t("regionAverages")}>
      <table className="w-full min-w-[28rem] text-sm">
        <caption className="sr-only">{t("regionAverages")}</caption>
        <thead className="bg-muted text-muted-fg">
          <tr><th scope="col" className="px-4 py-2 text-start">{tp("commodity")}</th><th scope="col" className="px-4 py-2 text-end">{tp("average")}</th><th scope="col" className="px-4 py-2 text-end">{tp("marketsReporting")}</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} className="border-t border-border">
              <th scope="row" className="px-4 py-3 text-start font-medium"><Link href={`/${countrySlug(cc)}/prices/${slugOf(r.code)}`} className="hover:text-brand hover:underline">{r.name}</Link></th>
              <td className="px-4 py-3 text-end"><PriceCell amount={r.avg} currency={r.currency} unit={r.unit} /></td>
              <td className="px-4 py-3 text-end text-muted-fg">{t("reports", { n: r.n })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

async function Body({ params }: Pick<P, "params">) {
  const { locale, country, region } = await params;
  setRequestLocale(locale);
  const c = packCountry(country), r = c && packRegion(c.iso2, region);
  if (!c || !r) notFound();
  const t = await getTranslations("pub");
  const vars = { region: pick(r.name, locale), country: pick(c.name, locale), count: c.commodityCodes.length };
  const markets = packMarkets(c.iso2).filter((m) => m.region === r.code);
  const area = {
    "@context": "https://schema.org", "@type": "AdministrativeArea", name: vars.region,
    containedInPlace: { "@type": "Country", name: vars.country },
    geo: { "@type": "GeoCoordinates", latitude: r.centroid[0], longitude: r.centroid[1] },
  };
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <JsonLd data={[area, breadcrumbs([
        { name: "AgriPrice", url: `/${locale}` },
        { name: t("regionsTitle", { country: vars.country }), url: `/${locale}/${country}/regions` },
        { name: vars.region, url: `/${locale}/${country}/regions/${region}` },
      ], env.siteUrl)]} />
      <PageHeader crumbs={[{ label: t("home"), href: "/" }, { label: t("regionsTitle", { country: vars.country }), href: `/${country}/regions` }, { label: vars.region }]}
        title={t("regionTitle", vars)} description={t("regionDescription", vars)} />
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="avg" className="space-y-3">
          <h2 id="avg" className="text-xl font-semibold">{t("regionAverages")}</h2>
          <Suspense fallback={<Skeleton className="h-64" />}><Averages cc={c.iso2} regionCode={r.code} locale={locale} /></Suspense>
        </section>
        <aside aria-labelledby="mk" className="space-y-3">
          <h2 id="mk" className="text-xl font-semibold">{t("marketsInRegion")}</h2>
          {markets.length ? (
            <ul className="divide-y divide-border rounded-2xl border border-border bg-card text-sm">
              {markets.map((m) => (
                <li key={m.code}><Link href={`/${country}/markets/${marketSlug(m.code)}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-muted">
                  <span className="font-medium">{pick(m.name, locale)}</span><span className="text-muted-fg">{t(`type_${m.type}`)}</span>
                </Link></li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-fg">{t("notReported")}</p>}
          <p className="text-xs text-muted-fg">{number(markets.length, locale)} · {t("allMarkets")}</p>
        </aside>
      </div>
    </div>
  );
}

export default function RegionPage({ params }: P) {
  return <Suspense fallback={<PageFallback />}><Body params={params} /></Suspense>;
}
