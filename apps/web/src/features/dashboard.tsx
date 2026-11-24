"use client";
import { BarChart3, Bell, BrainCircuit, ChevronRight, Database, MapPin, Store, Wheat } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Change } from "@/components/price/change";
import { Card, CardTitle, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { useAlerts, useMe, useSnapshot, useTrending } from "@/lib/api/queries";
import { formatMoney, greetingPeriod, pick } from "@/lib/utils";
import { QueryState } from "./common";

export function Dashboard() {
  const t = useTranslations("app");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const snapshot = useSnapshot(cc);
  const trending = useTrending(cc);
  const alerts = useAlerts();
  const name = me.data?.fullName?.split(" ")[0] ?? "";
  const nf = new Intl.NumberFormat(locale);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{me.data ? t("greeting", { period: t(greetingPeriod(new Date().getHours())), name }) : <Skeleton className="h-8 w-64" />}</h1>
      </div>

      <section aria-labelledby="snap"><h2 id="snap" className="sr-only">{t("snapshot")}</h2>
        <QueryState q={snapshot} skeleton={<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>}>
          {(s) => (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {([[Wheat, t("commodities"), s.commodities], [Store, t("markets"), s.markets], [MapPin, t("regions"), s.regions], [Database, t("records"), s.priceRecords]] as const).map(([Icon, label, v]) => (
                <Card key={label} className="flex items-center gap-3"><Icon aria-hidden className="size-8 rounded-lg bg-leaf/15 p-1.5 text-brand" /><div><p className="text-2xl font-bold tabular">{nf.format(v)}</p><p className="text-xs text-muted-fg">{label}</p></div></Card>
              ))}
            </div>
          )}
        </QueryState>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between"><CardTitle>{t("trending")}</CardTitle><Link href="/app/commodities" className="text-sm font-semibold text-brand hover:underline">{t("seeAll")}</Link></div>
          <QueryState q={trending} empty={(d) => !d.length}>
            {(items) => (
              <ul className="divide-y divide-border">
                {items.map((i) => (
                  <li key={i.commodityId}>
                    <Link href={`/app/commodities/${i.commodityId}`} className="flex items-center justify-between gap-4 py-3 hover:text-brand">
                      <span className="font-medium">{pick(i.commodityName, locale)}</span>
                      <span className="flex items-center gap-4"><span className="tabular">{formatMoney(i.current, i.currency, locale)}/{i.unit}</span><Change pct={i.changePct} className="w-20 justify-end" /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </Card>

        <div className="space-y-6">
          <Link href="/app/forecast" className="block">
            <Card className="flex items-center gap-3 bg-info hover:ring-2 hover:ring-ring">
              <BrainCircuit aria-hidden className="size-8 text-brand" />
              <div className="flex-1"><p className="font-semibold">{t("aiBannerTitle")}</p><p className="text-sm text-muted-fg">{t("aiBannerBody")}</p></div>
              <ChevronRight aria-hidden className="size-5" />
            </Card>
          </Link>
          <Card>
            <div className="flex items-center justify-between"><CardTitle className="flex items-center gap-2"><Bell aria-hidden className="size-5 text-brand" />{t("alertsSummary")}</CardTitle><Link href="/app/alerts" className="text-sm font-semibold text-brand hover:underline">{t("manage")}</Link></div>
            <QueryState q={alerts}>{(a) => <p className="mt-2 text-sm">{t("activeAlerts", { count: a.filter((x) => x.active).length })}</p>}</QueryState>
          </Card>
          <Card className="flex items-center gap-3"><BarChart3 aria-hidden className="size-6 text-forecast" /><Link href="/app/markets" className="font-semibold hover:text-brand">{t("comparison")}</Link></Card>
        </div>
      </div>
    </div>
  );
}
