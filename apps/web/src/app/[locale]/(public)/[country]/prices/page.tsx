import type { Metadata } from "next";
import { PageFallback } from "@/components/ui/page-fallback";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { alternates, breadcrumbs, JsonLd } from "@/components/seo/json-ld";
import { Change } from "@/components/price/change";
import { Card, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { getCommodities, getLatest, liveData, slugOf } from "@/lib/api/public";
import { countrySlug, packCommodity, packCountries, packCountry } from "@/lib/countries";
import { env } from "@/lib/env";
import { formatMoney, pick } from "@/lib/utils";

export function generateStaticParams() {
  return packCountries().map((c) => ({ country: countrySlug(c.iso2) }));
}

export async function generateMetadata({ params }: PageProps<"/[locale]/[country]/prices">): Promise<Metadata> {
  const { locale, country } = await params;
  const c = packCountry(country);
  if (!c) return {};
  const t = await getTranslations({ locale, namespace: "prices" });
  const name = pick(c.name, locale);
  return {
    title: t("indexTitle", { country: name }),
    description: t("indexDescription", { count: c.commodityCodes.length, country: name }),
    alternates: alternates(`/${country}/prices`, locale),
  };
}

/** One row per tracked commodity: median of the latest per-market prices (display currency/unit from the API). */
async function Row({ code, cc, locale }: { code: string; cc: string; locale: string }) {
  await liveData();
  const list = await getCommodities(cc, locale);
  const commodity = list?.find((x) => x.code === code);
  const latest = commodity ? await getLatest(commodity.id, cc) : null;
  const pc = packCommodity(code);
  const name = commodity ? pick(commodity.name, locale) : pick(pc?.name, locale);
  const vals = (latest ?? []).map((l) => Number(l.value.display.amount)).sort((a, b) => a - b);
  const med = vals.length ? vals[Math.floor(vals.length / 2)] : null;
  const changes = (latest ?? []).map((l) => l.changePctWoW).filter((x): x is number => x != null);
  const avgChange = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : null;
  const unit = latest?.[0]?.value.display.unit ?? "kg";
  const currency = latest?.[0]?.value.display.currency;
  return (
    <tr className="border-t border-border">
      <th scope="row" className="py-3 text-start font-medium"><Link href={`/${countrySlug(cc)}/prices/${slugOf(code)}`} className="hover:text-brand hover:underline">{name}</Link></th>
      <td className="py-3 text-end tabular">{med != null && currency ? `${formatMoney(med, currency, locale)}/${unit}` : "—"}</td>
      <td className="py-3 text-end"><Change pct={avgChange} /></td>
      <td className="hidden py-3 text-end text-muted-fg sm:table-cell">{latest?.length ?? 0}</td>
    </tr>
  );
}

async function PricesIndexBody({ params }: Pick<PageProps<"/[locale]/[country]/prices">, "params">) {
  const { locale, country } = await params;
  setRequestLocale(locale);
  const c = packCountry(country);
  if (!c) notFound();
  const t = await getTranslations("prices");
  const name = pick(c.name, locale);
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <JsonLd data={breadcrumbs([{ name: "AgriPrice", url: `/${locale}` }, { name: t("indexTitle", { country: name }), url: `/${locale}/${country}/prices` }], env.siteUrl)} />
      <h1 className="text-3xl font-bold">{t("indexTitle", { country: name })}</h1>
      <p className="mt-2 text-muted-fg">{t("indexDescription", { count: c.commodityCodes.length, country: name })}</p>
      <Card className="mt-8 overflow-x-auto p-0" tabIndex={0} role="region" aria-label={t("indexTitle", { country: name })}>
        <table className="w-full min-w-[28rem] text-sm">
          <thead className="bg-muted text-muted-fg">
            <tr><th scope="col" className="px-4 py-2 text-start">{t("commodity")}</th><th scope="col" className="py-2 text-end">{t("price")}</th><th scope="col" className="py-2 text-end">{t("change")}</th><th scope="col" className="hidden px-4 py-2 text-end sm:table-cell">{t("marketsReporting")}</th></tr>
          </thead>
          <tbody className="[&_td]:px-4 [&_th]:px-4">
            {c.commodityCodes.map((code) => (
              <Suspense key={code} fallback={<tr className="border-t border-border"><td colSpan={4} className="py-3"><Skeleton className="h-5" /></td></tr>}>
                <Row code={code} cc={c.iso2} locale={locale} />
              </Suspense>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/** Params are read inside Suspense so the shared shell stays instant; generateStaticParams still prerenders the content. */
export default function PricesIndex({ params }: PageProps<"/[locale]/[country]/prices">) {
  return <Suspense fallback={<PageFallback />}><PricesIndexBody params={params} /></Suspense>;
}
