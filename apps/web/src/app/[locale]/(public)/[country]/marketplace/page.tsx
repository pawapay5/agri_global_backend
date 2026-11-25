import { BadgeCheck } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PriceCell } from "@/components/agri/price-cell";
import { PageHeader } from "@/components/content/page-header";
import { alternates, breadcrumbs, JsonLd } from "@/components/seo/json-ld";
import { PageFallback } from "@/components/ui/page-fallback";
import { Card, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { getListings, idSlug, liveData } from "@/lib/api/public";
import { countrySlug, packCountries, packCountry } from "@/lib/countries";
import { env } from "@/lib/env";
import { number, unitLabel } from "@/lib/format";
import { pick } from "@/lib/utils";

type P = PageProps<"/[locale]/[country]/marketplace">;
const isUrl = (u?: string) => !!u && /^https?:\/\//.test(u);

export function generateStaticParams() {
  return packCountries().map((c) => ({ country: countrySlug(c.iso2) }));
}

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale, country } = await params;
  const c = packCountry(country);
  if (!c) return {};
  const t = await getTranslations({ locale, namespace: "pub" });
  const vars = { country: pick(c.name, locale) };
  return { title: t("marketplaceTitle", vars), description: t("marketplaceDescription", vars), alternates: alternates(`/${country}/marketplace`, locale) };
}

async function Listings({ cc, country, locale }: { cc: string; country: string; locale: string }) {
  await liveData();
  const t = await getTranslations({ locale, namespace: "pub" });
  const page = await getListings(cc);
  if (!page) return <p className="text-muted-fg">{t("unavailable")}</p>;
  const items = page.data.filter((l) => l.id && l.title && (l.status === "active" || l.status === "low_stock"));
  if (!items.length) return <p className="rounded-xl bg-muted p-6 text-center text-sm text-muted-fg">{t("noListings")}</p>;
  return (
    <>
      <JsonLd data={{
        "@context": "https://schema.org", "@type": "ItemList",
        itemListElement: items.map((l, i) => ({ "@type": "ListItem", position: i + 1, url: `${env.siteUrl}/${locale}/${country}/marketplace/${idSlug(l.title!, l.id!)}` })),
      }} />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((l) => {
          const photo = l.photos?.[0]?.urls;
          return (
            <li key={l.id}>
              <Link href={`/${country}/marketplace/${idSlug(l.title!, l.id!)}`} className="block h-full">
                <Card className="flex h-full flex-col gap-3 p-0 transition hover:ring-2 hover:ring-[var(--ring)]">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-t-2xl bg-muted">
                    {isUrl(photo?.medium) ? <Image src={photo!.medium!} alt="" fill sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="object-cover" /> : null}
                  </div>
                  <div className="flex flex-1 flex-col gap-1 px-4 pb-4">
                    <h2 className="font-semibold">{l.title}</h2>
                    {l.pricePerUnit && l.currency && l.unit ? <PriceCell amount={l.pricePerUnit} currency={l.currency} unit={l.unit} className="text-lg font-semibold" /> : null}
                    <p className="text-sm text-muted-fg">{t("quantity")}: {number(l.quantity, locale)} {unitLabel(l.unit)}</p>
                    {l.seller?.displayName ? (
                      <p className="mt-auto flex items-center gap-1 pt-2 text-sm">
                        {l.seller.displayName}
                        {l.seller.verified ? <BadgeCheck aria-label={t("verifiedSeller")} className="size-4 text-brand" /> : null}
                      </p>
                    ) : null}
                  </div>
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

async function Body({ params }: Pick<P, "params">) {
  const { locale, country } = await params;
  setRequestLocale(locale);
  const c = packCountry(country);
  if (!c) notFound();
  const t = await getTranslations("pub");
  const vars = { country: pick(c.name, locale) };
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <JsonLd data={breadcrumbs([{ name: "AgriPrice", url: `/${locale}` }, { name: t("marketplaceTitle", vars), url: `/${locale}/${country}/marketplace` }], env.siteUrl)} />
      <PageHeader crumbs={[{ label: t("home"), href: "/" }, { label: t("marketplaceTitle", vars) }]} title={t("marketplaceTitle", vars)} description={t("marketplaceDescription", vars)} />
      <Suspense fallback={<Skeleton className="h-96" />}><Listings cc={c.iso2} country={country} locale={locale} /></Suspense>
    </div>
  );
}

export default function MarketplaceIndex({ params }: P) {
  return <Suspense fallback={<PageFallback />}><Body params={params} /></Suspense>;
}
