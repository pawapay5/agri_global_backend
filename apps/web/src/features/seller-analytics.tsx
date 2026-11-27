"use client";
import { BarChart3 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsStringLiteral, useQueryStates } from "nuqs";
import { ColumnChart, Funnel, LineChart, RankedBars, VizCard } from "@/components/agri/charts/viz";
import { EmptyState } from "@/components/agri/empty-state";
import { RangeTabs } from "@/components/agri/range-tabs";
import { StatCard } from "@/components/agri/stat-card";
import { Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { useSellerSeries, useSellerSummary, useTopProducts, type Period } from "@/lib/api/market";
import { money, number, pctPlain } from "@/lib/format";

const PERIODS = ["7d", "30d", "90d", "365d"] as const;
const METRICS = ["revenue", "orders", "views", "offers", "kg_sold"] as const;
/** Past this many days, columns get too thin to read: draw a line instead. */
const COLUMN_MAX_POINTS = 95;

/** /app/sell/analytics: KPIs vs the previous period, one metric over time, the sales funnel and top listings. */
export function SellerAnalytics() {
  const t = useTranslations("sell");
  const locale = useLocale();
  const [q, setQ] = useQueryStates({ period: parseAsStringLiteral(PERIODS).withDefault("30d"), metric: parseAsStringLiteral(METRICS).withDefault("revenue") });
  const period = q.period as Period;
  const summary = useSellerSummary(period);
  const series = useSellerSeries(q.metric, period);
  const top = useTopProducts(period);
  const s = summary.data;
  const cur = s?.currency ?? series.data?.currency ?? "";
  const kpi = (label: string, k?: { value?: number; changePct?: number | null }, fmt: (n?: number) => string = (n) => number(n, locale)) => (
    <StatCard label={label} value={k ? fmt(k.value) : "—"} delta={k?.changePct != null ? { value: k.changePct, period: t("vsPrevious") } : undefined} />
  );
  const fmtMetric = (v: number) => (q.metric === "revenue" ? money(v, cur, locale, { compact: v >= 10_000 }) : number(v, locale, q.metric === "kg_sold" ? { digits: 1 } : { compact: v >= 10_000 }));
  const points = (series.data?.points ?? []) as { t: string; v: number }[];
  const day = (d: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(d));
  const metricName = t(`m_${q.metric}`);
  const funnel = s ? [
    { key: "views", name: t("m_views"), value: s.views?.value ?? 0 },
    { key: "placed", name: t("ordersPlaced"), value: s.ordersPlaced?.value ?? 0 },
    { key: "done", name: t("ordersCompleted"), value: s.ordersCompleted?.value ?? 0 },
  ] : [];
  const topRows = (top.data ?? []).map((p) => ({ id: p.listingId ?? "", title: p.title ?? "—", revenue: p.revenue ?? 0, orders: p.orders ?? 0, kgSold: p.kgSold ?? 0 }))
    .sort((a, b) => b.revenue - a.revenue).slice(0, 8);

  return (
    <div className="space-y-6">
      {/* One filter row above everything it scopes. */}
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

      <VizCard title={metricName} subtitle={t(`p_${q.period}`)} fetching={series.isFetching && !series.isPending}
        action={<RangeTabs size="sm" label={t("metric")} value={q.metric} onChange={(v) => void setQ({ metric: v === "revenue" ? null : v })} options={METRICS.map((m) => ({ value: m, label: t(`m_${m}`) }))} />}
        table={points.length ? { caption: `${metricName} · ${t(`p_${q.period}`)}`, columns: [t("date"), metricName], rows: points.map((p) => [day(p.t), fmtMetric(p.v)]) } : undefined}>
        {series.isPending ? <Skeleton className="h-60" /> : !points.length || points.every((p) => !p.v) ? <EmptyState icon={BarChart3} title={t("noData")} className="border-none" /> : (
          points.length <= COLUMN_MAX_POINTS
            ? <ColumnChart height={240} format={fmtMetric} summary={`${metricName}, ${t(`p_${q.period}`)}`}
                series={[{ key: "v", name: metricName, color: "var(--viz-single)" }]} data={points.map((p) => ({ key: p.t, label: day(p.t), values: [p.v] }))} />
            : <LineChart height={240} format={fmtMetric} name={metricName} summary={`${metricName}, ${t(`p_${q.period}`)}`}
                points={points.map((p) => ({ key: p.t, label: day(p.t), value: p.v }))} />
        )}
      </VizCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <VizCard title={t("funnel")} subtitle={t("funnelSub")}
          table={funnel.length ? { caption: t("funnel"), columns: [t("stage"), t("count")], rows: funnel.map((f) => [f.name, number(f.value, locale)]) } : undefined}>
          {summary.isPending ? <Skeleton className="h-40" /> : !funnel.some((f) => f.value) ? <p className="text-sm text-muted-fg">{t("noData")}</p> : (
            <Funnel stages={funnel} format={(v) => number(v, locale)} conversionLabel={(p) => t("ofPrevious", { pct: p })} />
          )}
        </VizCard>

        <VizCard title={t("topProducts")} subtitle={t("byRevenue")}
          table={topRows.length ? { caption: t("topProducts"), columns: [t("listings"), t("revenue"), t("ordersPlaced"), t("kgSold")],
            rows: topRows.map((p) => [p.title, money(p.revenue, cur, locale), number(p.orders, locale), number(p.kgSold, locale, { digits: 1 })]) } : undefined}>
          {top.isPending ? <Skeleton className="h-40" /> : !topRows.length ? <p className="text-sm text-muted-fg">{t("noData")}</p> : (
            <div className="space-y-3">
              <RankedBars rows={topRows.map((p) => ({ key: p.id, label: p.title, value: p.revenue, display: money(p.revenue, cur, locale),
                sub: t("ordersN", { n: p.orders }) }))} />
              <p className="text-xs text-muted-fg"><Link href="/app/sell/listings" className="font-semibold text-brand hover:underline">{t("listings")} →</Link></p>
            </div>
          )}
        </VizCard>
      </div>
    </div>
  );
}
