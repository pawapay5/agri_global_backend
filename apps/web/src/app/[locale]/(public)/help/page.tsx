import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/content/page-header";
import { alternates, JsonLd } from "@/components/seo/json-ld";
import { PageFallback } from "@/components/ui/page-fallback";
import { Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { getArticles, getFaqs, liveData } from "@/lib/api/public";
import { defaultCountry } from "@/lib/seo";

type P = PageProps<"/[locale]/help">;

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pub" });
  return { title: t("helpTitle"), description: t("helpDescription"), alternates: alternates("/help", locale) };
}

async function Content({ locale }: { locale: string }) {
  await liveData();
  const t = await getTranslations({ locale, namespace: "pub" });
  const dc = defaultCountry();
  const [faqs, articles] = dc ? await Promise.all([getFaqs(dc.iso2, locale), getArticles(dc.iso2, locale)]) : [null, null];
  const qa = (faqs ?? []).filter((f) => f.question && f.answer);
  const list = (articles ?? []).filter((a) => a.slug && a.title && !["privacy", "terms"].includes(a.slug));
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_20rem]">
      <section aria-labelledby="faq">
        <h2 id="faq" className="mb-4 text-xl font-semibold">{t("faqs")}</h2>
        {qa.length ? (
          <>
            <JsonLd data={{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: qa.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })) }} />
            <div className="divide-y divide-border rounded-2xl border border-border bg-card">
              {qa.map((f) => (
                <details key={f.id ?? f.question} className="group px-4 py-3">
                  <summary className="cursor-pointer list-none font-medium marker:hidden [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center justify-between gap-3">{f.question}<span aria-hidden className="text-muted-fg transition group-open:rotate-45">+</span></span>
                  </summary>
                  <p className="mt-2 whitespace-pre-line text-sm text-muted-fg">{f.answer}</p>
                </details>
              ))}
            </div>
          </>
        ) : <p className="text-sm text-muted-fg">{faqs ? t("noArticles") : t("unavailable")}</p>}
      </section>
      <aside aria-labelledby="articles">
        <h2 id="articles" className="mb-4 text-xl font-semibold">{t("articles")}</h2>
        {list.length ? (
          <ul className="space-y-2">{list.map((a) => <li key={a.slug}><Link href={`/help/${a.slug}`} className="font-medium text-brand hover:underline">{a.title}</Link></li>)}</ul>
        ) : <p className="text-sm text-muted-fg">{t("noArticles")}</p>}
      </aside>
    </div>
  );
}

async function Body({ params }: Pick<P, "params">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pub");
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <PageHeader crumbs={[{ label: t("home"), href: "/" }, { label: t("helpTitle") }]} title={t("helpTitle")} description={t("helpDescription")} />
      <Suspense fallback={<Skeleton className="h-96" />}><Content locale={locale} /></Suspense>
    </div>
  );
}

export default function HelpIndex({ params }: P) {
  return <Suspense fallback={<PageFallback />}><Body params={params} /></Suspense>;
}
