import { BadgeCheck, Clock } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PriceCell } from "@/components/agri/price-cell";
import { PageHeader } from "@/components/content/page-header";
import { alternates, breadcrumbs, JsonLd } from "@/components/seo/json-ld";
import { PageFallback } from "@/components/ui/page-fallback";
import { buttonVariants, Card } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { getListing, idFromSlug, liveData } from "@/lib/api/public";
import { packCountry } from "@/lib/countries";
import { env } from "@/lib/env";
import { number, shortDate, unitLabel } from "@/lib/format";
import { cn, pick } from "@/lib/utils";

type P = PageProps<"/[locale]/[country]/marketplace/[listing]">;
const isUrl = (u?: string) => !!u && /^https?:\/\//.test(u);
const AVAILABILITY: Record<string, string> = {
  active: "https://schema.org/InStock", low_stock: "https://schema.org/LimitedAvailability", sold_out: "https://schema.org/OutOfStock",
};

async function load(slug: string) {
  const id = idFromSlug(slug);
  return id ? getListing(id) : null;
}

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale, country, listing } = await params;
  const l = await load(listing);
  if (!l?.title) return { robots: { index: false } };
  const photo = l.photos?.[0]?.urls?.large;
  return {
    title: l.title,
    description: (l.description ?? "").slice(0, 160) || undefined,
    alternates: alternates(`/${country}/marketplace/${listing}`, locale),
    openGraph: { title: l.title, description: (l.description ?? "").slice(0, 200), type: "website", images: isUrl(photo) ? [photo!] : undefined },
    // Removed or draft listings shouldn't stay in search results.
    robots: l.status === "active" || l.status === "low_stock" || l.status === "sold_out" ? undefined : { index: false },
  };
}

async function Body({ params }: Pick<P, "params">) {
  const { locale, country, listing } = await params;
  setRequestLocale(locale);
  const c = packCountry(country);
  if (!c) notFound();
  await liveData();
  const t = await getTranslations("pub");
  const l = await load(listing);
  if (!l?.id || !l.title) notFound();
  const listed = l.status === "active" || l.status === "low_stock" || l.status === "sold_out";
  const url = `${env.siteUrl}/${locale}/${country}/marketplace/${listing}`;
  const photos = (l.photos ?? []).filter((p) => isUrl(p.urls?.large));
  const product = listed && l.pricePerUnit && l.currency ? {
    "@context": "https://schema.org", "@type": "Product", name: l.title, description: l.description ?? undefined,
    image: photos.map((p) => p.urls!.large!),
    offers: {
      "@type": "Offer", url, price: l.pricePerUnit, priceCurrency: l.currency, availability: AVAILABILITY[l.status ?? ""] ?? "https://schema.org/InStock",
      eligibleQuantity: l.minOrderQty ? { "@type": "QuantitativeValue", minValue: Number(l.minOrderQty), unitText: unitLabel(l.unit) } : undefined,
      seller: l.seller?.displayName ? { "@type": "Organization", name: l.seller.displayName } : undefined,
    },
  } : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <JsonLd data={[...(product ? [product] : []), breadcrumbs([
        { name: "AgriPrice", url: `/${locale}` },
        { name: t("marketplaceTitle", { country: pick(c.name, locale) }), url: `/${locale}/${country}/marketplace` },
        { name: l.title, url: `/${locale}/${country}/marketplace/${listing}` },
      ], env.siteUrl)]} />
      <PageHeader crumbs={[{ label: t("home"), href: "/" }, { label: t("marketplaceTitle", { country: pick(c.name, locale) }), href: `/${country}/marketplace` }, { label: l.title }]} title={l.title} />
      {!listed ? <p className="rounded-xl bg-muted p-6 text-center text-sm text-muted-fg">{t("listingUnavailable")}</p> : (
        <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-4">
            {photos.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {photos.map((p, i) => (
                  <div key={p.id} className={cn("relative overflow-hidden rounded-2xl bg-muted", i === 0 ? "aspect-[4/3] sm:col-span-2" : "aspect-square")}>
                    <Image src={p.urls!.large!} alt="" fill priority={i === 0} sizes={i === 0 ? "(min-width: 1024px) 60vw, 100vw" : "(min-width: 640px) 30vw, 100vw"} className="object-cover" />
                  </div>
                ))}
              </div>
            ) : null}
            {l.description ? <p className="whitespace-pre-line leading-relaxed">{l.description}</p> : null}
          </div>
          <Card className="h-fit space-y-4">
            {l.pricePerUnit && l.currency && l.unit ? <PriceCell amount={l.pricePerUnit} currency={l.currency} unit={l.unit} size="lg" /> : null}
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted-fg">{t("quantity")}</dt><dd className="font-medium">{number(l.quantity, locale)} {unitLabel(l.unit)}</dd></div>
              {l.minOrderQty ? <div className="flex justify-between gap-3"><dt className="text-muted-fg">{t("minOrder")}</dt><dd className="font-medium">{number(l.minOrderQty, locale)} {unitLabel(l.unit)}</dd></div> : null}
              {l.qualityGrade ? <div className="flex justify-between gap-3"><dt className="text-muted-fg">{t("grade")}</dt><dd className="font-medium">{l.qualityGrade}</dd></div> : null}
              {l.harvestDate ? <div className="flex justify-between gap-3"><dt className="text-muted-fg">{t("harvested", { date: "" }).trim()}</dt><dd className="font-medium">{shortDate(l.harvestDate, locale, { day: "numeric", month: "short", year: "numeric" })}</dd></div> : null}
            </dl>
            {l.seller?.displayName ? (
              <div className="border-t border-border pt-4 text-sm">
                <p className="text-muted-fg">{t("seller")}</p>
                <p className="flex items-center gap-1 font-semibold">{l.seller.displayName}{l.seller.verified ? <BadgeCheck aria-label={t("verifiedSeller")} className="size-4 text-brand" /> : null}</p>
                {l.seller.responseTimeMins ? <p className="mt-1 flex items-center gap-1 text-muted-fg"><Clock aria-hidden className="size-3.5" />{t("responds", { mins: l.seller.responseTimeMins })}</p> : null}
              </div>
            ) : null}
            {l.status !== "sold_out" ? (
              <Link href={`/login?next=${encodeURIComponent(`/${locale}/app/marketplace/${l.id}`)}`} prefetch={false} className={cn(buttonVariants({ size: "lg" }), "w-full")}>{t("signInToOrder")}</Link>
            ) : null}
          </Card>
        </div>
      )}
    </div>
  );
}

export default function ListingPage({ params }: P) {
  return <Suspense fallback={<PageFallback />}><Body params={params} /></Suspense>;
}
