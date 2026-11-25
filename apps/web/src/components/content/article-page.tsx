import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/content/markdown";
import { PageHeader } from "@/components/content/page-header";
import { breadcrumbs, JsonLd } from "@/components/seo/json-ld";
import { getArticle, liveData } from "@/lib/api/public";
import { env } from "@/lib/env";
import { shortDate } from "@/lib/format";

/**
 * A content-API article rendered as a page (help articles, legal documents). `pending` shows an honest
 * "being prepared" note instead of a 404 for documents that must exist (privacy, terms) but aren't published yet.
 */
export async function ArticlePage({ slug, locale, crumbs, path, pendingTitle }: {
  slug: string; locale: string; crumbs: { label: string; href?: string }[]; path: string; pendingTitle?: string;
}) {
  await liveData();
  const t = await getTranslations({ locale, namespace: "pub" });
  const a = await getArticle(slug, locale);
  if (!a?.title || !a.body) {
    if (!pendingTitle) notFound();
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <PageHeader crumbs={[...crumbs, { label: pendingTitle }]} title={pendingTitle} />
        <p className="rounded-xl bg-muted p-6 text-sm text-muted-fg">{t("legalPending")}</p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <JsonLd data={[
        { "@context": "https://schema.org", "@type": "Article", headline: a.title, dateModified: a.updatedAt, url: `${env.siteUrl}/${locale}${path}` },
        breadcrumbs([...crumbs.filter((c) => c.href).map((c) => ({ name: c.label, url: `/${locale}${c.href === "/" ? "" : c.href}` })), { name: a.title, url: `/${locale}${path}` }], env.siteUrl),
      ]} />
      <PageHeader crumbs={[...crumbs, { label: a.title }]} title={a.title}>
        {a.updatedAt ? <p className="text-xs text-muted-fg">{t("updated", { date: shortDate(a.updatedAt, locale, { day: "numeric", month: "long", year: "numeric" }) })}</p> : null}
      </PageHeader>
      <Markdown source={a.body} />
    </div>
  );
}
