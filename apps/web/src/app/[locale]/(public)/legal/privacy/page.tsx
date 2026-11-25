import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { ArticlePage } from "@/components/content/article-page";
import { alternates } from "@/components/seo/json-ld";
import { PageFallback } from "@/components/ui/page-fallback";

type P = PageProps<"/[locale]/legal/privacy">;

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pub" });
  return { title: t("privacyTitle"), alternates: alternates("/legal/privacy", locale) };
}

/** Published from the content API (article slug "privacy"); shows a "being prepared" note until then. */
async function Body({ params }: Pick<P, "params">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pub");
  return <ArticlePage slug="privacy" locale={locale} path="/legal/privacy" pendingTitle={t("privacyTitle")} crumbs={[{ label: t("home"), href: "/" }]} />;
}

export default function LegalPage({ params }: P) {
  return <Suspense fallback={<PageFallback />}><Body params={params} /></Suspense>;
}
