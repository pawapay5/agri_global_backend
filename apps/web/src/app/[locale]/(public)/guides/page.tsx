import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/content/page-header";
import { alternates } from "@/components/seo/json-ld";
import { PageFallback } from "@/components/ui/page-fallback";
import { Link } from "@/i18n/navigation";
import { slugOf } from "@/lib/api/public";
import { packCommodity, packCountries } from "@/lib/countries";
import { defaultCountry } from "@/lib/seo";
import { pick } from "@/lib/utils";

type P = PageProps<"/[locale]/guides">;

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pub" });
  return { title: t("guidesTitle"), description: t("guidesDescription", { country: pick(defaultCountry()?.name, locale) }), alternates: alternates("/guides", locale) };
}

/** One entry per tracked crop; each page shows the published guide or says there isn't one yet. */
async function Body({ params }: Pick<P, "params">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pub");
  const dc = defaultCountry();
  const codes = packCountries().find((c) => c.iso2 === dc?.iso2)?.commodityCodes ?? [];
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <PageHeader crumbs={[{ label: t("home"), href: "/" }, { label: t("guidesTitle") }]} title={t("guidesTitle")} description={t("guidesDescription", { country: pick(dc?.name, locale) })} />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {codes.map((code) => (
          <li key={code}><Link href={`/guides/${slugOf(code)}`} className="block rounded-2xl border border-border bg-card px-4 py-3 font-medium hover:border-brand">{pick(packCommodity(code)?.name, locale)}</Link></li>
        ))}
      </ul>
    </div>
  );
}

export default function GuidesIndex({ params }: P) {
  return <Suspense fallback={<PageFallback />}><Body params={params} /></Suspense>;
}
