import { MapPin } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChangeBadge } from "@/components/agri/change-badge";
import { DataFreshness } from "@/components/agri/data-freshness";
import { PriceCell } from "@/components/agri/price-cell";
import { PageHeader } from "@/components/content/page-header";
import { alternates, breadcrumbs, JsonLd } from "@/components/seo/json-ld";
import { PageFallback } from "@/components/ui/page-fallback";
import { Card, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { findMarket, getCommodities, getLatest, liveData, slugOf } from "@/lib/api/public";
import { countrySlug, marketSlug, packCountries, packCountry, packMarket, packMarkets, packRegions, regionSlug } from "@/lib/countries";
import { env } from "@/lib/env";
import { weekdays } from "@/lib/seo";
import { pick } from "@/lib/utils";

type P = PageProps<"/[locale]/[country]/markets/[market]">;

/** Every market of every launched country, from the packs (no API at build). */
export function generateStaticParams() {
  return packCountries().flatMap((c) => packMarkets(c.iso2).map((m) => ({ country: countrySlug(c.iso2), market: marketSlug(m.code) })));
}

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale, country, market } = await params;
  const c = packCountry(country), m = c && packMarket(c.iso2, market);
  if (!c || !m) return {};
  const t = await getTranslations({ locale, namespace: "pub" });
  const region = packRegions(c.iso2).find((r) => r.code === m.region);
  const vars = { market: pick(m.name, locale), region: pick(region?.name, locale), country: pick(c.name, locale), count: c.commodityCodes.length };
  return {
    title: t("marketTitle", vars),
    description: t("marketDescription", vars),
    alternates: alternates(`/${country}/markets/${market}`, locale),
  };
}

/** Latest price of each tracked crop at this market (each commodity's latest-prices call is cached and shared). */
async function LivePrices({ cc, code, locale }: { cc: string; code: string; locale: string }) {
  await liveData();
  const t = await getTranslations({ locale, namespace: "pub" });
  const tp = await getTranslations({ locale, namespace: "prices" });
  const [market, commodities] = await Promise.all([findMarket(cc, code), getCommodities(cc, locale)]);
  if (!market || !commodities) return <p className="text-muted-fg">{t("unavailable")}</p>;
  const tracked = packCountries().find((c) => c.iso2 === cc)?.commodityCodes ?? [];
  const rows = (await Promise.all(tracked.map(async (codeC) => {
    const commodity = commodities.find((x) => x.code === codeC);
    if (!commodity) return null;
    const latest = (await getLatest(commodity.id, cc))?.find((l) => l.marketId === market.id);
    return latest ? { code: codeC, name: pick(commodity.name, locale), latest } : null;
  }))).filter((r): r is NonNullable<typeof r> => r !== null);

  if (!rows.length) return <p className="rounded-xl bg-muted p-6 text-center text-sm text-muted-fg">{t("noPricesHere")}</p>;
  return (
    <Card className="overflow-x-auto p-0" tabIndex={0} role="region" aria-label={t("pricesHere")}>
      <table className="w-full min-w-[34rem] text-sm">
        <caption className="sr-only">{t("pricesHere")}</caption>
        <thead className="bg-muted text-muted-fg">
          <tr>
            <th scope="col" className="px-4 py-2 text-start">{tp("commodity")}</th>
            <th scope="col" className="px-4 py-2 text-end">{tp("price")}</th>
            <th scope="col" className="px-4 py-2 text-end">{tp("change")}</th>
            <th scope="col" className="px-4 py-2 text-end">{tp("updated")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} className="border-t border-border">
              <th scope="row" className="px-4 py-3 text-start font-medium"><Link href={`/${countrySlug(cc)}/prices/${slugOf(r.code)}`} className="hover:text-brand hover:underline">{r.name}</Link></th>
              <td className="px-4 py-3 text-end"><PriceCell amount={r.latest.value.display.amount} currency={r.latest.value.display.currency} unit={r.latest.value.display.unit} /></td>
              <td className="px-4 py-3 text-end"><ChangeBadge value={r.latest.changePctWoW} /></td>
              <td className="px-4 py-3 text-end"><DataFreshness at={r.latest.observedAt} className="justify-end" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

async function Body({ params }: Pick<P, "params">) {
  const { locale, country, market } = await params;
  setRequestLocale(locale);
  const c = packCountry(country), m = c && packMarket(c.iso2, market);
  if (!c || !m) notFound();
  const t = await getTranslations("pub");
  const region = packRegions(c.iso2).find((r) => r.code === m.region);
  const vars = { market: pick(m.name, locale), region: pick(region?.name, locale), country: pick(c.name, locale), count: c.commodityCodes.length };
  const [lat, lng] = m.location;
  const neighbours = packMarkets(c.iso2).filter((x) => x.region === m.region && x.code !== m.code);
  const place = {
    "@context": "https://schema.org", "@type": "Place", name: vars.market,
    geo: { "@type": "GeoCoordinates", latitude: lat, longitude: lng },
    address: { "@type": "PostalAddress", addressRegion: vars.region, addressCountry: c.iso2 },
    url: `${env.siteUrl}/${locale}/${country}/markets/${market}`,
  };
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <JsonLd data={[place, breadcrumbs([
        { name: "AgriPrice", url: `/${locale}` },
        { name: t("marketsTitle", { country: vars.country }), url: `/${locale}/${country}/markets` },
        { name: vars.market, url: `/${locale}/${country}/markets/${market}` },
      ], env.siteUrl)]} />
      <PageHeader
        crumbs={[{ label: t("home"), href: "/" }, { label: t("allMarkets"), href: `/${country}/markets` }, { label: vars.market }]}
        title={t("marketTitle", vars)} description={t("marketDescription", vars)}
      >
        <dl className="grid gap-3 pt-2 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-fg">{t("region")}</dt><dd className="font-medium">{region ? <Link href={`/${country}/regions/${regionSlug(region.code)}`} className="hover:text-brand hover:underline">{vars.region}</Link> : "—"}</dd></div>
          <div><dt className="text-muted-fg">{t("type")}</dt><dd className="font-medium">{t(`type_${m.type}`)}</dd></div>
          <div><dt className="text-muted-fg">{t("tradingDays")}</dt><dd className="font-medium">{m.operatingDays.length === 7 ? t("everyDay") : m.operatingDays.length ? weekdays(m.operatingDays, locale) : t("notReported")}</dd></div>
        </dl>
        <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`} rel="noopener noreferrer" target="_blank"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"><MapPin aria-hidden className="size-4" />{t("openInMap")}</a>
      </PageHeader>

      <section aria-labelledby="prices-here" className="space-y-3">
        <h2 id="prices-here" className="text-xl font-semibold">{t("pricesHere")}</h2>
        <Suspense fallback={<Skeleton className="h-64" />}><LivePrices cc={c.iso2} code={m.code} locale={locale} /></Suspense>
      </section>

      {neighbours.length ? (
        <section aria-labelledby="nearby" className="mt-10 space-y-3">
          <h2 id="nearby" className="text-xl font-semibold">{t("marketsInRegion")}</h2>
          <ul className="flex flex-wrap gap-2">
            {neighbours.map((n) => (
              <li key={n.code}><Link href={`/${country}/markets/${marketSlug(n.code)}`} className="inline-block rounded-full border border-border bg-card px-3 py-1.5 text-sm hover:border-brand">{pick(n.name, locale)}</Link></li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export default function MarketPage({ params }: P) {
  return <Suspense fallback={<PageFallback />}><Body params={params} /></Suspense>;
}
