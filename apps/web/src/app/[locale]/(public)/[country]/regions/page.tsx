import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RegionHeatmap, type RegionFeature } from "@/components/agri/region-heatmap";
import { PageHeader } from "@/components/content/page-header";
import { alternates, breadcrumbs, JsonLd } from "@/components/seo/json-ld";
import { PageFallback } from "@/components/ui/page-fallback";
import { Card, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { getChoropleth, getCommodities, getRegionsGeo, liveData } from "@/lib/api/public";
import { countrySlug, packCountries, packCountry, packMarkets, packRegions, regionSlug } from "@/lib/countries";
import { env } from "@/lib/env";
import { pick } from "@/lib/utils";

type P = PageProps<"/[locale]/[country]/regions">;

export function generateStaticParams() {
  return packCountries().map((c) => ({ country: countrySlug(c.iso2) }));
}

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale, country } = await params;
  const c = packCountry(country);
  if (!c) return {};
  const t = await getTranslations({ locale, namespace: "pub" });
  const vars = { country: pick(c.name, locale), count: packRegions(c.iso2).length };
  return { title: t("regionsTitle", vars), description: t("regionsDescription", vars), alternates: alternates(`/${country}/regions`, locale) };
}

/** Heatmap for the first tracked crop: region shapes and 30-day averages from the API (streamed, cached). */
async function Heatmap({ cc, locale }: { cc: string; locale: string }) {
  await liveData();
  const t = await getTranslations({ locale, namespace: "pub" });
  const code = packCountries().find((c) => c.iso2 === cc)?.commodityCodes[0];
  const commodity = (await getCommodities(cc, locale))?.find((c) => c.code === code);
  if (!commodity) return null;
  const [geo, choropleth] = await Promise.all([getRegionsGeo(cc), getChoropleth(commodity.id, cc)]);
  const features = (geo as { features?: RegionFeature[] } | null)?.features;
  if (!features?.length || !choropleth) return null;
  const title = t("heatmapTitle", { commodity: pick(commodity.name, locale) });
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">{title}</h2>
      <RegionHeatmap geojson={{ features }} values={choropleth.regions} currency={choropleth.currency} unit={choropleth.unit} title={title} />
    </Card>
  );
}

async function Body({ params }: Pick<P, "params">) {
  const { locale, country } = await params;
  setRequestLocale(locale);
  const c = packCountry(country);
  if (!c) notFound();
  const t = await getTranslations("pub");
  const vars = { country: pick(c.name, locale), count: packRegions(c.iso2).length };
  const markets = packMarkets(c.iso2);
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <JsonLd data={breadcrumbs([{ name: "AgriPrice", url: `/${locale}` }, { name: t("regionsTitle", vars), url: `/${locale}/${country}/regions` }], env.siteUrl)} />
      <PageHeader crumbs={[{ label: t("home"), href: "/" }, { label: t("regionsTitle", vars) }]} title={t("regionsTitle", vars)} description={t("regionsDescription", vars)} />
      <div className="grid gap-8 lg:grid-cols-[1fr_minmax(0,26rem)]">
        <ul className="grid content-start gap-3 sm:grid-cols-2">
          {packRegions(c.iso2).map((r) => {
            const n = markets.filter((m) => m.region === r.code).length;
            return (
              <li key={r.code}>
                <Link href={`/${country}/regions/${regionSlug(r.code)}`} className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3 hover:border-brand">
                  <span className="font-medium">{pick(r.name, locale)}</span>
                  <span className="text-sm text-muted-fg">{n ? `${n} ${t("allMarkets").toLowerCase()}` : ""}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <Suspense fallback={<Skeleton className="h-[28rem]" />}><Heatmap cc={c.iso2} locale={locale} /></Suspense>
      </div>
    </div>
  );
}

export default function RegionsIndex({ params }: P) {
  return <Suspense fallback={<PageFallback />}><Body params={params} /></Suspense>;
}
