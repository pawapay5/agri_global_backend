import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Markdown } from "@/components/content/markdown";
import { PageHeader } from "@/components/content/page-header";
import { alternates, breadcrumbs, JsonLd } from "@/components/seo/json-ld";
import { PageFallback } from "@/components/ui/page-fallback";
import { getPest, idFromSlug, liveData } from "@/lib/api/public";
import { env } from "@/lib/env";
import { shortDate } from "@/lib/format";

type P = PageProps<"/[locale]/pests/[slug]">;
const isUrl = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//.test(u);

async function load(slug: string, locale: string) {
  const id = idFromSlug(slug);
  return id ? getPest(id, locale) : null;
}

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale, slug } = await params;
  const p = await load(slug, locale);
  if (!p?.name) return { robots: { index: false } };
  return { title: p.name, description: (p.symptoms ?? "").slice(0, 160) || undefined, alternates: alternates(`/pests/${slug}`, locale) };
}

async function Body({ params }: Pick<P, "params">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  await liveData();
  const t = await getTranslations("pub");
  const p = await load(slug, locale);
  if (!p?.name) notFound();
  const photos = (p.photos ?? []).filter((ph) => isUrl(ph.urls?.large ?? ph.urls?.medium));
  const sections = [["symptoms", p.symptoms], ["prevention", p.prevention], ["organicControl", p.organicControl], ["chemicalControl", p.chemicalControl]] as const;
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <JsonLd data={[
        { "@context": "https://schema.org", "@type": "Article", headline: p.name, about: p.scientificName ?? p.name, dateModified: p.reviewedAt ?? undefined, url: `${env.siteUrl}/${locale}/pests/${slug}` },
        breadcrumbs([{ name: "AgriPrice", url: `/${locale}` }, { name: t("pestsTitle"), url: `/${locale}/pests` }, { name: p.name, url: `/${locale}/pests/${slug}` }], env.siteUrl),
      ]} />
      <PageHeader crumbs={[{ label: t("home"), href: "/" }, { label: t("pestsTitle"), href: "/pests" }, { label: p.name }]} title={p.name}>
        <p className="text-sm text-muted-fg">
          {p.kind ? t(`kind_${p.kind}` as "kind_pest") : null}{p.scientificName ? <> · <i>{p.scientificName}</i></> : null}
          {p.reviewedAt ? <> · {t("reviewed", { date: shortDate(p.reviewedAt, locale, { day: "numeric", month: "long", year: "numeric" }) })}</> : null}
        </p>
      </PageHeader>
      {photos.length ? (
        <figure className="mb-6 grid gap-3 sm:grid-cols-2">
          {photos.slice(0, 4).map((ph, i) => (
            <div key={i} className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-muted">
              <Image src={(ph.urls!.large ?? ph.urls!.medium) as string} alt={ph.caption ?? ""} fill sizes="(min-width: 640px) 50vw, 100vw" className="object-cover" priority={i === 0} />
              {ph.credit ? <span className="absolute bottom-1 end-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">{ph.credit}</span> : null}
            </div>
          ))}
        </figure>
      ) : null}
      {sections.map(([k, body]) => body ? (
        <section key={k} className="mt-6"><h2 className="text-xl font-bold">{t(k)}</h2><Markdown source={body} /></section>
      ) : null)}
      {p.safetyNote ? (
        <aside className="mt-8 flex gap-3 rounded-2xl bg-down/10 p-4 text-sm" aria-label={t("safety")}>
          <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-down-ink" />
          <div><p className="font-semibold">{t("safety")}</p><Markdown source={p.safetyNote} /></div>
        </aside>
      ) : null}
    </div>
  );
}

export default function PestPage({ params }: P) {
  return <Suspense fallback={<PageFallback />}><Body params={params} /></Suspense>;
}
