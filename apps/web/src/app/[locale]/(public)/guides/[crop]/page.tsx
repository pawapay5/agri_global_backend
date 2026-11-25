import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Markdown } from "@/components/content/markdown";
import { PageHeader } from "@/components/content/page-header";
import { alternates, breadcrumbs, JsonLd } from "@/components/seo/json-ld";
import { PageFallback } from "@/components/ui/page-fallback";
import { Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { codeOf, findCommodity, getGuide, getGuides, liveData } from "@/lib/api/public";
import { packCommodity } from "@/lib/countries";
import { env } from "@/lib/env";
import { shortDate } from "@/lib/format";
import { defaultCountry } from "@/lib/seo";
import { pick } from "@/lib/utils";

type P = PageProps<"/[locale]/guides/[crop]">;

// No generateStaticParams: whether a guide exists (and so the title and the noindex decision) comes from the API,
// which builds can't reach. Pages render on first request and are then served from the cache ("use cache" fetchers).

async function loadGuide(crop: string, locale: string) {
  const dc = defaultCountry();
  if (!dc) return null;
  const commodity = await findCommodity(dc.iso2, crop, locale);
  if (!commodity) return null;
  const first = (await getGuides(dc.iso2, locale, commodity.id))?.[0];
  return first?.id ? getGuide(first.id, locale) : null;
}

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale, crop } = await params;
  const pc = packCommodity(codeOf(crop));
  if (!pc) return {};
  const t = await getTranslations({ locale, namespace: "pub" });
  const guide = await loadGuide(crop, locale);
  return {
    title: guide?.title ?? t("guideTitle", { crop: pick(pc.name, locale) }),
    description: guide?.summary ?? undefined,
    alternates: alternates(`/guides/${crop}`, locale),
    // A crop without a published guide is a thin page: keep it out of search results until there is one.
    robots: guide ? undefined : { index: false, follow: true },
  };
}

async function Guide({ crop, locale, cropName }: { crop: string; locale: string; cropName: string }) {
  await liveData();
  const t = await getTranslations({ locale, namespace: "pub" });
  const guide = await loadGuide(crop, locale);
  if (!guide) return <p className="rounded-xl bg-muted p-6 text-center text-sm text-muted-fg">{t("noGuide")}</p>;
  const article = {
    "@context": "https://schema.org", "@type": "Article", headline: guide.title, description: guide.summary,
    dateModified: guide.updatedAt, about: cropName, url: `${env.siteUrl}/${locale}/guides/${crop}`,
  };
  return (
    <article>
      <JsonLd data={article} />
      {guide.summary ? <p className="text-lg text-muted-fg">{guide.summary}</p> : null}
      <p className="mt-2 text-xs text-muted-fg">
        {guide.reviewedAt ? t("reviewed", { date: shortDate(guide.reviewedAt, locale, { day: "numeric", month: "long", year: "numeric" }) }) : guide.updatedAt ? t("updated", { date: shortDate(guide.updatedAt, locale, { day: "numeric", month: "long", year: "numeric" }) }) : null}
      </p>
      {(guide.sections ?? []).map((s) => (
        <section key={s.key ?? s.title} className="mt-8">
          {s.title ? <h2 className="text-xl font-bold">{s.title}</h2> : null}
          {s.body ? <Markdown source={s.body} /> : null}
        </section>
      ))}
    </article>
  );
}

async function Body({ params }: Pick<P, "params">) {
  const { locale, crop } = await params;
  setRequestLocale(locale);
  const pc = packCommodity(codeOf(crop));
  if (!pc) notFound();
  const t = await getTranslations("pub");
  const dc = defaultCountry();
  const name = pick(pc.name, locale);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <JsonLd data={breadcrumbs([{ name: "AgriPrice", url: `/${locale}` }, { name: t("guidesTitle"), url: `/${locale}/guides` }, { name, url: `/${locale}/guides/${crop}` }], env.siteUrl)} />
      <PageHeader crumbs={[{ label: t("home"), href: "/" }, { label: t("guidesTitle"), href: "/guides" }, { label: name }]} title={t("guideTitle", { crop: name })}>
        {dc ? <Link href={`/${dc.slug}/prices/${crop}`} className="text-sm font-medium text-brand hover:underline">{t("pricesFor", { crop: name })} →</Link> : null}
      </PageHeader>
      <Suspense fallback={<Skeleton className="h-96" />}><Guide crop={crop} locale={locale} cropName={name} /></Suspense>
    </div>
  );
}

export default function GuidePage({ params }: P) {
  return <Suspense fallback={<PageFallback />}><Body params={params} /></Suspense>;
}
