import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/content/page-header";
import { alternates, JsonLd } from "@/components/seo/json-ld";
import { PageFallback } from "@/components/ui/page-fallback";
import { Link } from "@/i18n/navigation";
import { env } from "@/lib/env";
import { defaultCountry } from "@/lib/seo";
import { pick } from "@/lib/utils";

type P = PageProps<"/[locale]/about">;

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pub" });
  return { title: t("aboutTitle"), description: t("aboutDescription"), alternates: alternates("/about", locale) };
}

/** What AgriPrice does, in plain terms. No claims about the company that the product can't back up. */
async function Body({ params }: Pick<P, "params">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pub");
  const tn = await getTranslations("footer");
  const country = pick(defaultCountry()?.name, locale);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <JsonLd data={{ "@context": "https://schema.org", "@type": "Organization", name: "AgriPrice", url: env.siteUrl, description: t("aboutDescription") }} />
      <PageHeader crumbs={[{ label: t("home"), href: "/" }, { label: t("aboutTitle") }]} title={t("aboutTitle")} description={t("aboutDescription")} />
      <div className="space-y-4 text-lg leading-relaxed">
        <p>{t("about1", { country })}</p>
        <p>{t("about2")}</p>
        <p>{t("about3")} <Link href="/methodology" className="font-medium text-brand hover:underline">{tn("methodology")} →</Link></p>
      </div>
    </div>
  );
}

export default function AboutPage({ params }: P) {
  return <Suspense fallback={<PageFallback />}><Body params={params} /></Suspense>;
}
