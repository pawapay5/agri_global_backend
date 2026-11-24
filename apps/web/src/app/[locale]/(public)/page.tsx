import { BarChart3, Bell, BrainCircuit, MapPinned } from "lucide-react";
import { PageFallback } from "@/components/ui/page-fallback";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { alternates } from "@/components/seo/json-ld";
import { Change } from "@/components/price/change";
import { buttonVariants, Card, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { getCommodities, getImpact, getTrending, liveData, slugOf } from "@/lib/api/public";
import { countrySlug, packCountries } from "@/lib/countries";
import { cn, formatMoney, pick } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing" });
  const c = packCountries()[0];
  return { title: { absolute: `${c?.brand ?? "AgriPrice"}: ${t("heroBody")}` }, description: t("heroBody"), alternates: alternates("", locale) };
}

async function Ticker({ cc, locale }: { cc: string; locale: string }) {
  const t = await getTranslations({ locale, namespace: "landing" });
  await liveData();
  const [items, catalogue] = await Promise.all([getTrending(cc), getCommodities(cc, locale)]);
  const codeById = new Map((catalogue ?? []).map((c) => [c.id, c.code]));
  if (!items?.length) return <p className="text-sm text-white/80">{t("tickerEmpty")}</p>;
  return (
    <ul className="flex gap-6 overflow-x-auto pb-1 text-sm" aria-label={t("tickerTitle")}>
      {items.map((i) => (
        <li key={i.commodityId} className="flex shrink-0 items-center gap-2">
          {codeById.get(i.commodityId) ? (
            <Link href={`/${countrySlug(cc)}/prices/${slugOf(codeById.get(i.commodityId)!)}`} className="font-semibold text-white hover:underline">{pick(i.commodityName, locale)}</Link>
          ) : <span className="font-semibold">{pick(i.commodityName, locale)}</span>}
          <span className="tabular text-white/90">{formatMoney(i.current, i.currency, locale)}/{i.unit}</span>
          <Change pct={i.changePct} className="rounded bg-white/90 px-1" />
        </li>
      ))}
    </ul>
  );
}

async function Impact({ cc, locale }: { cc: string; locale: string }) {
  const t = await getTranslations({ locale, namespace: "landing" });
  await liveData();
  const s = await getImpact(cc);
  if (!s) return null;
  const nf = new Intl.NumberFormat(locale, { notation: "compact" });
  const stats = [[t("impactMarkets"), s.markets], [t("impactCommodities"), s.commodities], [t("impactRecords"), s.priceRecords], [t("impactFarmers"), s.farmers]] as const;
  return (
    <section className="mx-auto max-w-7xl px-4 py-12">
      <h2 className="mb-6 text-2xl font-bold">{t("impactTitle")}</h2>
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map(([label, v]) => (
          <Card key={label}><dt className="text-sm text-muted-fg">{label}</dt><dd className="mt-1 text-3xl font-bold tabular text-brand">{v == null ? "—" : nf.format(v)}</dd></Card>
        ))}
      </dl>
    </section>
  );
}

async function LandingBody({ params }: Pick<PageProps<"/[locale]">, "params">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("landing");
  const country = packCountries()[0];
  const cc = country?.iso2 ?? "GH";
  const features = [
    { icon: BarChart3, title: t("f1Title"), body: t("f1Body") },
    { icon: BrainCircuit, title: t("f2Title"), body: t("f2Body") },
    { icon: Bell, title: t("f3Title"), body: t("f3Body") },
    { icon: MapPinned, title: t("f4Title"), body: t("f4Body") },
  ];
  return (
    <>
      <section className="bg-brand text-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 md:grid-cols-2 md:py-24">
          <div className="space-y-6">
            <h1 className="text-4xl font-bold leading-tight md:text-5xl">{t("heroTitle", { country: pick(country?.name, locale) || "Ghana" })}</h1>
            <p className="max-w-xl text-lg text-white/85">{t("heroBody")}</p>
            <div className="flex flex-wrap gap-3">
              <Link href="/signup" className={cn(buttonVariants({ size: "lg" }), "bg-white text-brand hover:bg-white/90")}>{t("ctaPrimary")}</Link>
              <Link href={`/${countrySlug(cc)}/prices`} className={cn(buttonVariants({ size: "lg", variant: "outline" }), "border-white text-white hover:bg-white/10")}>{t("ctaSecondary")}</Link>
            </div>
          </div>
          <div className="self-end rounded-2xl bg-white/10 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/70">{t("tickerTitle")}</p>
            <Suspense fallback={<Skeleton className="h-6 w-full bg-white/20" />}><Ticker cc={cc} locale={locale} /></Suspense>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16">
        <h2 className="mb-8 max-w-2xl text-2xl font-bold md:text-3xl">{t("featuresTitle")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <Card key={f.title} className="space-y-2 p-6">
              <f.icon aria-hidden className="size-8 text-leaf" />
              <h3 className="font-semibold">{f.title}</h3>
              <p className="text-sm text-muted-fg">{f.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <Suspense fallback={<div className="mx-auto max-w-7xl px-4 py-12"><Skeleton className="h-28" /></div>}><Impact cc={cc} locale={locale} /></Suspense>

      <section className="mx-auto max-w-7xl px-4 pb-16">
        <Card className="flex flex-col items-start gap-4 bg-info p-8 md:flex-row md:items-center md:justify-between">
          <div><h2 className="text-xl font-bold">{t("forecastTeaserTitle")}</h2><p className="mt-1 text-muted-fg">{t("forecastTeaserBody")}</p></div>
          <Link href="/signup" className={buttonVariants({ size: "lg" })}>{t("ctaPrimary")}</Link>
        </Card>
      </section>
    </>
  );
}

/** Params are read inside Suspense so the shared shell stays instant; generateStaticParams still prerenders the content. */
export default function Landing({ params }: PageProps<"/[locale]">) {
  return <Suspense fallback={<PageFallback />}><LandingBody params={params} /></Suspense>;
}
