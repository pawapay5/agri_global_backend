import { BarChart3, Bell, BrainCircuit, MapPinned } from "lucide-react";
import { PageFallback } from "@/components/ui/page-fallback";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { HeroCarousel } from "@/components/content/hero-carousel";
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
  if (!items?.length) return <p className="text-sm text-muted-fg">{t("tickerEmpty")}</p>;
  return (
    <ul className="flex gap-6 overflow-x-auto py-1 text-sm [scrollbar-width:none]" aria-label={t("tickerTitle")} tabIndex={0}>
      {items.map((i) => (
        <li key={i.commodityId} className="flex shrink-0 items-center gap-2">
          {codeById.get(i.commodityId) ? (
            <Link href={`/${countrySlug(cc)}/prices/${slugOf(codeById.get(i.commodityId)!)}`} className="font-semibold hover:text-brand hover:underline">{pick(i.commodityName, locale)}</Link>
          ) : <span className="font-semibold">{pick(i.commodityName, locale)}</span>}
          <span className="tabular text-muted-fg">{formatMoney(i.current, i.currency, locale)}/{i.unit}</span>
          <Change pct={i.changePct} />
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
    <section className="mx-auto max-w-7xl px-4 pb-20">
      <h2 className="mb-8 text-balance text-3xl font-bold tracking-tight">{t("impactTitle")}</h2>
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map(([label, v]) => (
          <Card key={label} className="p-6"><dt className="text-sm text-muted-fg">{label}</dt><dd className="mt-2 text-4xl font-bold tabular tracking-tight text-brand dark:text-leaf">{v == null ? "—" : nf.format(v)}</dd></Card>
        ))}
      </dl>
    </section>
  );
}

async function LandingBody({ params }: Pick<PageProps<"/[locale]">, "params">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("landing");
  const th = await getTranslations("home");
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
      <HeroCarousel>
        <div className="mx-auto max-w-7xl px-4 pb-10 pt-20 md:pb-16 md:pt-32">
          <div className="max-w-2xl space-y-6">
            <p className="animate-rise inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white/90 backdrop-blur">
              <span aria-hidden className="size-1.5 rounded-full bg-leaf" />{th("eyebrow")}
            </p>
            <h1 className="animate-rise-2 text-balance text-4xl font-bold leading-[1.1] tracking-tight drop-shadow-sm md:text-6xl">{t("heroTitle", { country: pick(country?.name, locale) || "Ghana" })}</h1>
            <p className="animate-rise-2 max-w-xl text-lg text-white/90 md:text-xl">{t("heroBody")}</p>
            <div className="animate-rise-3 flex flex-wrap items-center gap-3">
              <Link href="/signup" prefetch={false} className={cn(buttonVariants({ size: "lg" }), "bg-white text-hero shadow-lg hover:bg-white/90")}>{t("ctaPrimary")}</Link>
              <Link href={`/${countrySlug(cc)}/prices`} className={cn(buttonVariants({ size: "lg", variant: "outline" }), "border-white/70 bg-white/5 text-white backdrop-blur hover:bg-white/15")}>{t("ctaSecondary")}</Link>
              <span className="text-sm text-white/80">{th("trust")}</span>
            </div>
          </div>
        </div>
      </HeroCarousel>

      <section aria-labelledby="ticker-title" className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <p id="ticker-title" className="flex shrink-0 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-fg">
            <span aria-hidden className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-leaf/60 motion-reduce:hidden" /><span className="relative inline-flex size-2 rounded-full bg-leaf" /></span>
            <span className="hidden sm:inline">{t("tickerTitle")}</span>
          </p>
          <div className="min-w-0 flex-1"><Suspense fallback={<Skeleton className="h-6 w-full" />}><Ticker cc={cc} locale={locale} /></Suspense></div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20">
        <div className="mb-10 max-w-2xl">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-brand dark:text-leaf">{th("eyebrow")}</p>
          <h2 className="text-balance text-3xl font-bold tracking-tight md:text-4xl">{t("featuresTitle")}</h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <Card key={f.title} className="group space-y-3 p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-elev-2">
              <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-leaf/20 to-brand/10 text-brand ring-1 ring-inset ring-leaf/20 transition-transform duration-300 group-hover:scale-110 dark:text-leaf">
                <f.icon aria-hidden className="size-6" />
              </span>
              <h3 className="text-lg font-semibold">{f.title}</h3>
              <p className="text-sm leading-relaxed text-muted-fg">{f.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <Suspense fallback={<div className="mx-auto max-w-7xl px-4 pb-20"><Skeleton className="h-28" /></div>}><Impact cc={cc} locale={locale} /></Suspense>

      <section className="mx-auto max-w-7xl px-4 pb-20">
        <div className="relative overflow-hidden rounded-3xl bg-hero px-6 py-12 text-hero-fg shadow-elev-2 md:px-12">
          <div aria-hidden className="absolute -end-24 -top-24 size-72 rounded-full bg-leaf/25 blur-3xl" />
          <div aria-hidden className="absolute -bottom-32 -start-16 size-72 rounded-full bg-white/10 blur-3xl" />
          <div className="relative flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
            <div className="max-w-xl"><h2 className="text-balance text-2xl font-bold md:text-3xl">{t("forecastTeaserTitle")}</h2><p className="mt-2 text-white/85">{t("forecastTeaserBody")}</p></div>
            <Link href="/signup" prefetch={false} className={cn(buttonVariants({ size: "lg" }), "bg-white text-hero shadow-lg hover:bg-white/90")}>{t("ctaPrimary")}</Link>
          </div>
        </div>
      </section>
    </>
  );
}

/** Params are read inside Suspense so the shared shell stays instant; generateStaticParams still prerenders the content. */
export default function Landing({ params }: PageProps<"/[locale]">) {
  return <Suspense fallback={<PageFallback />}><LandingBody params={params} /></Suspense>;
}
