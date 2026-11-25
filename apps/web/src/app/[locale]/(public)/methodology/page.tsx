import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/content/page-header";
import { Section } from "@/components/content/section";
import { alternates, JsonLd } from "@/components/seo/json-ld";
import { PageFallback } from "@/components/ui/page-fallback";
import { Card } from "@/components/ui/primitives";
import { packCountries, packSources } from "@/lib/countries";
import { env } from "@/lib/env";
import { METHODOLOGY } from "@/lib/methodology";

type P = PageProps<"/[locale]/methodology">;

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pub" });
  return { title: t("methodologyTitle"), description: t("methodologyDescription"), alternates: alternates("/methodology", locale) };
}

/** Static: the sources come from the country packs and the numbers from lib/methodology (tested against the code). */
async function Body({ params }: Pick<P, "params">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pub");
  const sources = packCountries().flatMap((c) => packSources(c.iso2).map((s) => ({ ...s, country: c.iso2 })));
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <JsonLd data={{ "@context": "https://schema.org", "@type": "TechArticle", headline: t("methodologyTitle"), description: t("methodologyDescription"), url: `${env.siteUrl}/${locale}/methodology` }} />
      <PageHeader crumbs={[{ label: t("home"), href: "/" }, { label: t("methodologyTitle") }]} title={t("methodologyTitle")} description={t("methodologyDescription")} />

      <Section title={t("m_sourcesTitle")}>
        <p>{t("m_sourcesBody")}</p>
        <ul className="grid gap-3">
          {sources.map((s) => (
            <li key={`${s.country}:${s.code}`}>
              <Card className="space-y-1 py-3">
                <p className="font-semibold">{s.url ? <a href={s.url} rel="noopener noreferrer" target="_blank" className="hover:text-brand hover:underline">{s.name}</a> : s.name}</p>
                {s.licence ? <p className="text-sm text-muted-fg">{t("m_licence", { licence: s.licence })}</p> : null}
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("m_cleanTitle")}><p>{t("m_clean1")}</p><p>{t("m_clean2")}</p><p>{t("m_clean3")}</p></Section>
      <Section title={t("m_aggTitle")}><p>{t("m_agg")}</p></Section>
      <Section title={t("m_fcTitle")}><p>{t("m_fc1")}</p><p>{t("m_fc2")}</p></Section>
      <Section title={t("m_guardTitle")}>
        <p>{t("m_guard", { weeks: METHODOLOGY.minHistoryWeeks, days: METHODOLOGY.maxStalenessDays, mape: METHODOLOGY.maxBacktestMape })}</p>
      </Section>
      <Section title={t("m_explainTitle")}><p>{t("m_explain")}</p></Section>
    </div>
  );
}

export default function MethodologyPage({ params }: P) {
  return <Suspense fallback={<PageFallback />}><Body params={params} /></Suspense>;
}
