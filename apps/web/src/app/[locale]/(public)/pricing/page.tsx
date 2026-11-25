import { Check, Minus } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/content/page-header";
import { alternates } from "@/components/seo/json-ld";
import { PageFallback } from "@/components/ui/page-fallback";
import { buttonVariants, Card, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { getPlans, liveData, type S } from "@/lib/api/public";
import { packCountries } from "@/lib/countries";
import { money, number } from "@/lib/format";
import { defaultCountry } from "@/lib/seo";
import { cn, pick } from "@/lib/utils";

type P = PageProps<"/[locale]/pricing">;
type Ent = keyof S["Entitlements"];
const ROWS: Ent[] = ["forecast_horizons", "history_range", "alerts_max", "alert_channels", "reports_per_month", "report_formats", "export_insights", "recommendations", "api_daily_quota", "api_keys_max", "seats"];

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pub" });
  return { title: t("pricingTitle"), description: t("pricingDescription"), alternates: alternates("/pricing", locale) };
}

/** Plans and entitlements exactly as the billing API returns them, priced in the country's currency. */
async function Plans({ locale }: { locale: string }) {
  await liveData();
  const t = await getTranslations({ locale, namespace: "pub" });
  const dc = defaultCountry();
  const currency = packCountries().find((c) => c.iso2 === dc?.iso2)?.currency ?? "";
  const plans = dc ? (await getPlans(dc.iso2, locale))?.filter((p) => p.code) : null;
  if (!plans?.length) return <p className="text-muted-fg">{t("plansUnavailable")}</p>;
  const cell = (v: unknown, k: Ent) => {
    if (typeof v === "boolean") return v ? <Check aria-label={t("yes")} className="mx-auto size-5 text-up" /> : <Minus aria-label={t("no")} className="mx-auto size-5 text-muted-fg" />;
    if (Array.isArray(v)) return k === "forecast_horizons" ? v.map((m) => t("months", { n: m })).join(", ") : v.join(", ");
    if (typeof v === "number") return number(v, locale);
    return "—";
  };
  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const own = p.prices?.[currency];
          const cur = own ? currency : Object.keys(p.prices ?? {})[0] ?? currency;
          const price = own ?? Object.values(p.prices ?? {})[0];
          const premium = p.code === "premium";
          return (
            <Card key={p.code} className={cn("flex flex-col gap-4", premium && "ring-2 ring-[var(--ring)]")}>
              <h2 className="text-lg font-semibold">{pick(p.name, locale) || p.code}</h2>
              <p className="text-3xl font-semibold">
                {p.code === "free" || !price?.monthly ? t("free") : <>{money(price.monthly, cur, locale)}<span className="text-base font-normal text-muted-fg">{t("perMonth")}</span></>}
              </p>
              {p.code !== "free" && price?.yearly ? <p className="-mt-3 text-sm text-muted-fg">{money(price.yearly, cur, locale)}{t("perYear")}</p> : null}
              <Link href="/signup" prefetch={false} className={cn(buttonVariants({ variant: premium ? "primary" : "outline" }), "mt-auto")}>{t("choose")}</Link>
            </Card>
          );
        })}
      </div>
      <Card className="overflow-x-auto p-0" tabIndex={0} role="region" aria-label={t("pricingTitle")}>
        <table className="w-full min-w-[36rem] text-sm">
          <caption className="sr-only">{t("pricingTitle")}</caption>
          <thead className="bg-muted text-muted-fg">
            <tr><td className="px-4 py-2" />{plans.map((p) => <th key={p.code} scope="col" className="px-4 py-2 text-center">{pick(p.name, locale) || p.code}</th>)}</tr>
          </thead>
          <tbody>
            {ROWS.filter((k) => plans.some((p) => p.entitlements?.[k] !== undefined)).map((k) => (
              <tr key={k} className="border-t border-border">
                <th scope="row" className="px-4 py-2.5 text-start font-medium">{t(`ent_${k}`)}</th>
                {plans.map((p) => <td key={p.code} className="px-4 py-2.5 text-center tabular">{cell(p.entitlements?.[k], k)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

async function Body({ params }: Pick<P, "params">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pub");
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <PageHeader crumbs={[{ label: t("home"), href: "/" }, { label: t("pricingTitle") }]} title={t("pricingTitle")} description={t("pricingDescription")} />
      <Suspense fallback={<Skeleton className="h-96" />}><Plans locale={locale} /></Suspense>
    </div>
  );
}

export default function PricingPage({ params }: P) {
  return <Suspense fallback={<PageFallback />}><Body params={params} /></Suspense>;
}
