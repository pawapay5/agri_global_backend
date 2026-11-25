import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { Markdown } from "@/components/content/markdown";
import { PageHeader } from "@/components/content/page-header";
import { alternates } from "@/components/seo/json-ld";
import { PageFallback } from "@/components/ui/page-fallback";
import { Card, Skeleton } from "@/components/ui/primitives";
import { getAllStories, liveData } from "@/lib/api/public";
import { shortDate } from "@/lib/format";
import { defaultCountry } from "@/lib/seo";

type P = PageProps<"/[locale]/stories">;
const isUrl = (u?: string | null): u is string => !!u && /^https?:\/\//.test(u);

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pub" });
  return { title: t("storiesTitle"), description: t("storiesDescription"), alternates: alternates("/stories", locale) };
}

async function Stories({ locale }: { locale: string }) {
  await liveData();
  const t = await getTranslations({ locale, namespace: "pub" });
  const dc = defaultCountry();
  const stories = (dc ? await getAllStories(dc.iso2, locale) : null)?.filter((s) => s.title && s.body);
  if (!stories) return <p className="text-muted-fg">{t("unavailable")}</p>;
  if (!stories.length) return <p className="rounded-xl bg-muted p-6 text-center text-sm text-muted-fg">{t("noStories")}</p>;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {stories.map((s) => (
        <Card key={s.id ?? s.title} className="space-y-3">
          {isUrl(s.imageUrl) ? <div className="relative aspect-video overflow-hidden rounded-xl bg-muted"><Image src={s.imageUrl} alt="" fill sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" /></div> : null}
          <h2 className="text-lg font-semibold">{s.title}</h2>
          <Markdown source={s.body!} className="text-sm" />
          {s.personName ? <p className="text-sm font-medium">{s.personName}{s.personRole ? <span className="font-normal text-muted-fg"> · {s.personRole}</span> : null}</p> : null}
          {s.publishedAt ? <p className="text-xs text-muted-fg">{shortDate(s.publishedAt, locale, { month: "long", year: "numeric" })}</p> : null}
        </Card>
      ))}
    </div>
  );
}

async function Body({ params }: Pick<P, "params">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pub");
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <PageHeader crumbs={[{ label: t("home"), href: "/" }, { label: t("storiesTitle") }]} title={t("storiesTitle")} description={t("storiesDescription")} />
      <Suspense fallback={<Skeleton className="h-96" />}><Stories locale={locale} /></Suspense>
    </div>
  );
}

export default function StoriesPage({ params }: P) {
  return <Suspense fallback={<PageFallback />}><Body params={params} /></Suspense>;
}
