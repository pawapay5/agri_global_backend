import { CircleAlert, CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/content/page-header";
import { alternates } from "@/components/seo/json-ld";
import { PageFallback } from "@/components/ui/page-fallback";
import { Card, Skeleton } from "@/components/ui/primitives";
import { upstreamSignal } from "@/lib/auth/tokens";
import { env } from "@/lib/env";
import { absoluteTime } from "@/lib/format";

type P = PageProps<"/[locale]/status">;

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pub" });
  return { title: t("statusTitle"), description: t("statusDescription"), alternates: alternates("/status", locale) };
}

/** Live and uncached: asks the API's readiness probe at request time. Shows component state only, nothing internal. */
async function Live({ locale }: { locale: string }) {
  await connection();
  const t = await getTranslations({ locale, namespace: "pub" });
  let api = false, db = false, cache = false;
  try {
    const r = await fetch(`${env.apiUrl}/readyz`, { cache: "no-store", signal: upstreamSignal() });
    api = true;
    const body = (await r.json().catch(() => null)) as { checks?: { postgres?: string; redis?: string } } | null;
    db = body?.checks?.postgres === "up";
    cache = body?.checks?.redis === "up";
  } catch { /* API unreachable */ }
  const rows: [string, boolean][] = [[t("s_web"), true], [t("s_api"), api], [t("s_db"), db], [t("s_cache"), cache]];
  return (
    <div className="space-y-3">
      <Card className="divide-y divide-border p-0">
        {rows.map(([name, up]) => (
          <div key={name} className="flex items-center justify-between px-4 py-3">
            <span className="font-medium">{name}</span>
            <span className={`flex items-center gap-1.5 text-sm font-semibold ${up ? "text-up" : "text-down"}`}>
              {up ? <CircleCheck aria-hidden className="size-4" /> : <CircleAlert aria-hidden className="size-4" />}{up ? t("s_up") : t("s_down")}
            </span>
          </div>
        ))}
      </Card>
      <p className="text-xs text-muted-fg">{t("s_checked", { time: absoluteTime(new Date().toISOString(), locale) })}</p>
    </div>
  );
}

async function Body({ params }: Pick<P, "params">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pub");
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <PageHeader crumbs={[{ label: t("home"), href: "/" }, { label: t("statusTitle") }]} title={t("statusTitle")} description={t("statusDescription")} />
      <Suspense fallback={<Skeleton className="h-48" />}><Live locale={locale} /></Suspense>
    </div>
  );
}

export default function StatusPage({ params }: P) {
  return <Suspense fallback={<PageFallback />}><Body params={params} /></Suspense>;
}
