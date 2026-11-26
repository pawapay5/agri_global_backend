"use client";
import { BarChart3 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsStringLiteral, useQueryStates } from "nuqs";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "@/components/agri/empty-state";
import { RangeTabs } from "@/components/agri/range-tabs";
import { StatCard } from "@/components/agri/stat-card";
import { Card, CardTitle, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { useSellerSeries, useSellerSummary, useTopProducts, type Period } from "@/lib/api/market";
import { money, number, pctPlain } from "@/lib/format";

const PERIODS = ["7d", "30d", "90d", "365d"] as const;
const METRICS = ["revenue", "orders", "views", "offers", "kg_sold"] as const;

/** /app/sell/analytics (no mockup): KPIs vs the previous period, one metric over time, top listings. */
export function SellerAnalytics() {
  const t = useTranslations("sell");
  const td = useTranslations("ds");
  const locale = useLocale();
  const [q, setQ] = useQueryStates({ period: parseAsStringLiteral(PERIODS).withDefault("30d"), metric: parseAsStringLiteral(METRICS).withDefault("revenue") });
  const period = q.period as Period;
  const summary = useSellerSummary(period);
  const series = useSellerSeries(q.metric, period);
  const top = useTopProducts(period);
  const [table, setTable] = useState(false);
  const s = summary.data;
  const cur = s?.currency ?? series.data?.currency ?? "";
  const kpi = (label: string, k?: { value?: number; changePct?: number | null }, fmt: (n?: number) => string = (n) => number(n, locale)) => (
    <StatCard label={label} value={k ? fmt(k.value) : "—"} delta={k?.changePct != null ? { value: k.changePct, period: t("vsPrevious") } : undefined} />
  );
  const fmtMetric = (v: number) => (q.metric === "revenue" ? money(v, cur, locale) : number(v, locale, q.metric === "kg_sold" ? { digits: 1 } : {}));
  const points = (series.data?.points ?? []) as { t: string; v: number }[];
  const day = (d: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(d));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("analytics")}</h1>
        <RangeTabs size="sm" label={t("period")} value={q.period} onChange={(v) => void setQ({ period: v === "30d" ? null : v })} options={PERIODS.map((p) => ({ value: p, label: t(`p_${p}`) }))} />
      </div>
      {summary.isPending ? <Skeleton className="h-28" /> : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpi(t("revenue"), s?.revenue, (n) => money(n, cur, locale))}
          {kpi(t("ordersCompleted"), s?.ordersCompleted)}
          {kpi(t("activeBuyers"), s?.activeBuyers)}
          {kpi(t("conversion"), s?.conversionPct, (n) => pctPlain(n, locale))}
        </div>
      )}
      {s?.cancellationRatePct != null ? <p className="text-sm text-muted-fg">{t("cancellation", { pct: pctPlain(s.cancellationRatePct, locale) })}</p> : null}

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{t(`m_${q.metric}`)}</CardTitle>
          <RangeTabs size="sm" label={t("metric")} value={q.metric} onChange={(v) => void setQ({ metric: v === "revenue" ? null : v })} options={METRICS.map((m) => ({ value: m, label: t(`m_${m}`) }))} />
        </div>
        {series.isPending ? <Skeleton className="h-64" /> : !points.length || points.every((p) => !p.v) ? <EmptyState icon={BarChart3} title={t("noData")} /> : (
          <>
            <figure aria-label={`${t(`m_${q.metric}`)} · ${t(`p_${q.period}`)}`} className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="t" tickFormatter={day} tick={{ fontSize: 11, fill: "var(--muted-fg)" }} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis tickFormatter={(v) => number(v as number, locale, { compact: true })} tick={{ fontSize: 11, fill: "var(--muted-fg)" }} axisLine={false} tickLine={false} width={48} />
                  <Tooltip cursor={{ fill: "var(--muted)" }} labelFormatter={(l) => day(String(l))} formatter={(v) => [fmtMetric(Number(v)), t(`m_${q.metric}`)]} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }} />
                  <Bar dataKey="v" radius={[4, 4, 0, 0]} maxBarSize={24} fill="var(--chart-history)" />
                </BarChart>
              </ResponsiveContainer>
            </figure>
            <button type="button" onClick={() => setTable((x) => !x)} aria-expanded={table} aria-controls="sa-table" className="text-xs font-semibold text-brand hover:underline">{table ? td("hideTable") : td("viewTable")}</button>
            <div id="sa-table" hidden={!table} className="max-h-72 overflow-auto rounded-xl border border-border" tabIndex={table ? 0 : -1} role="region" aria-label={t(`m_${q.metric}`)}>
              <table className="w-full text-sm"><caption className="sr-only">{t(`m_${q.metric}`)}</caption>
                <tbody>{points.map((p) => <tr key={p.t} className="border-t border-border first:border-0"><th scope="row" className="px-3 py-1.5 text-start font-normal">{day(p.t)}</th><td className="px-3 py-1.5 text-end tabular">{fmtMetric(p.v)}</td></tr>)}</tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <Card className="space-y-3 p-0">
        <CardTitle className="px-5 pt-5">{t("topProducts")}</CardTitle>
        {top.isPending ? <Skeleton className="m-5 h-40" /> : !top.data?.length ? <p className="px-5 pb-5 text-sm text-muted-fg">{t("noData")}</p> : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("topProducts")}>
            <table className="w-full min-w-[34rem] text-sm">
              <caption className="sr-only">{t("topProducts")}</caption>
              <thead className="bg-muted text-muted-fg"><tr>
                <th scope="col" className="px-4 py-2 text-start font-medium">{t("listings")}</th>
                <th scope="col" className="px-4 py-2 text-end font-medium">{t("revenue")}</th>
                <th scope="col" className="px-4 py-2 text-end font-medium">{t("ordersPlaced")}</th>
                <th scope="col" className="px-4 py-2 text-end font-medium">{t("kgSold")}</th>
              </tr></thead>
              <tbody>
                {top.data.map((p) => (
                  <tr key={p.listingId} className="border-t border-border">
                    <th scope="row" className="px-4 py-2 text-start font-normal"><Link href={`/app/sell/listings/${p.listingId}`} className="font-medium hover:text-brand hover:underline">{p.title}</Link></th>
                    <td className="px-4 py-2 text-end tabular">{money(p.revenue, cur, locale)}</td>
                    <td className="px-4 py-2 text-end tabular">{number(p.orders, locale)}</td>
                    <td className="px-4 py-2 text-end tabular">{number(p.kgSold, locale, { digits: 1 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
