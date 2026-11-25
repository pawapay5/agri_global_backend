import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/content/page-header";
import { alternates } from "@/components/seo/json-ld";
import { PageFallback } from "@/components/ui/page-fallback";
import { Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { getPests, idSlug, liveData } from "@/lib/api/public";
import { defaultCountry } from "@/lib/seo";
import { pick } from "@/lib/utils";

type P = PageProps<"/[locale]/pests">;
const KINDS = ["pest", "disease", "weed", "deficiency"] as const;

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pub" });
  return { title: t("pestsTitle"), description: t("pestsDescription", { country: pick(defaultCountry()?.name, locale) }), alternates: alternates("/pests", locale) };
}

async function List({ locale }: { locale: string }) {
  await liveData();
  const t = await getTranslations({ locale, namespace: "pub" });
  const dc = defaultCountry();
  const pests = dc ? await getPests(dc.iso2, locale) : null;
  if (!pests) return <p className="text-muted-fg">{t("unavailable")}</p>;
  const valid = pests.filter((p) => p.id && p.name);
  return (
    <div className="space-y-8">
      {KINDS.map((k) => {
        const items = valid.filter((p) => p.kind === k);
        if (!items.length) return null;
        return (
          <section key={k} aria-labelledby={`k-${k}`}>
            <h2 id={`k-${k}`} className="mb-3 text-xl font-semibold">{t(`kind_${k}`)}</h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((p) => (
                <li key={p.id}>
                  <Link href={`/pests/${idSlug(p.name!, p.id!)}`} className="block h-full rounded-2xl border border-border bg-card px-4 py-3 hover:border-brand">
                    <span className="font-medium">{p.name}</span>
                    {p.scientificName ? <span className="block text-sm italic text-muted-fg">{p.scientificName}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

async function Body({ params }: Pick<P, "params">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pub");
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <PageHeader crumbs={[{ label: t("home"), href: "/" }, { label: t("pestsTitle") }]} title={t("pestsTitle")} description={t("pestsDescription", { country: pick(defaultCountry()?.name, locale) })} />
      <Suspense fallback={<Skeleton className="h-96" />}><List locale={locale} /></Suspense>
    </div>
  );
}

export default function PestsIndex({ params }: P) {
  return <Suspense fallback={<PageFallback />}><Body params={params} /></Suspense>;
}
