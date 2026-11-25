import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/content/page-header";
import { alternates, breadcrumbs, JsonLd } from "@/components/seo/json-ld";
import { PageFallback } from "@/components/ui/page-fallback";
import { Card } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { countrySlug, marketSlug, packCountries, packCountry, packMarkets, packRegions, regionSlug } from "@/lib/countries";
import { env } from "@/lib/env";
import { pick } from "@/lib/utils";

type P = PageProps<"/[locale]/[country]/markets">;

export function generateStaticParams() {
  return packCountries().map((c) => ({ country: countrySlug(c.iso2) }));
}

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale, country } = await params;
  const c = packCountry(country);
  if (!c) return {};
  const t = await getTranslations({ locale, namespace: "pub" });
  const name = pick(c.name, locale);
  return {
    title: t("marketsTitle", { country: name }),
    description: t("marketsDescription", { count: packMarkets(c.iso2).length, country: name }),
    alternates: alternates(`/${country}/markets`, locale),
  };
}

/** Every market in the country pack, grouped by region. Static: no API needed. */
async function Body({ params }: Pick<P, "params">) {
  const { locale, country } = await params;
  setRequestLocale(locale);
  const c = packCountry(country);
  if (!c) notFound();
  const t = await getTranslations("pub");
  const name = pick(c.name, locale);
  const markets = packMarkets(c.iso2);
  const regions = packRegions(c.iso2).filter((r) => markets.some((m) => m.region === r.code));
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <JsonLd data={breadcrumbs([{ name: "AgriPrice", url: `/${locale}` }, { name: t("marketsTitle", { country: name }), url: `/${locale}/${country}/markets` }], env.siteUrl)} />
      <PageHeader crumbs={[{ label: t("home"), href: "/" }, { label: t("marketsTitle", { country: name }) }]}
        title={t("marketsTitle", { country: name })} description={t("marketsDescription", { count: markets.length, country: name })} />
      <div className="grid gap-6 md:grid-cols-2">
        {regions.map((r) => (
          <Card key={r.code} className="space-y-3">
            <h2 className="font-semibold"><Link href={`/${country}/regions/${regionSlug(r.code)}`} className="hover:text-brand hover:underline">{pick(r.name, locale)}</Link></h2>
            <ul className="space-y-1.5 text-sm">
              {markets.filter((m) => m.region === r.code).map((m) => (
                <li key={m.code} className="flex items-center justify-between gap-3">
                  <Link href={`/${country}/markets/${marketSlug(m.code)}`} className="font-medium hover:text-brand hover:underline">{pick(m.name, locale)}</Link>
                  <span className="text-muted-fg">{t(`type_${m.type}`)}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function MarketsIndex({ params }: P) {
  return <Suspense fallback={<PageFallback />}><Body params={params} /></Suspense>;
}
