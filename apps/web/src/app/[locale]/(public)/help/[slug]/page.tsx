import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { ArticlePage } from "@/components/content/article-page";
import { alternates } from "@/components/seo/json-ld";
import { PageFallback } from "@/components/ui/page-fallback";
import { getArticle } from "@/lib/api/public";

type P = PageProps<"/[locale]/help/[slug]">;

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale, slug } = await params;
  const a = await getArticle(slug, locale);
  if (!a?.title) return { robots: { index: false } };
  return { title: a.title, description: (a.body ?? "").replace(/[#*_>`[\]()]/g, "").slice(0, 160), alternates: alternates(`/help/${slug}`, locale) };
}

async function Body({ params }: Pick<P, "params">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pub");
  return <ArticlePage slug={slug} locale={locale} path={`/help/${slug}`} crumbs={[{ label: t("home"), href: "/" }, { label: t("helpTitle"), href: "/help" }]} />;
}

export default function HelpArticle({ params }: P) {
  return <Suspense fallback={<PageFallback />}><Body params={params} /></Suspense>;
}
