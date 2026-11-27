"use client";
import { Bell, BrainCircuit, ChevronRight, CloudSun, Database, Info, LineChart as LineIcon, MapPin, Sparkles, Store, Wheat } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSyncExternalStore, type ReactNode } from "react";
import { ChangeBadge } from "@/components/agri/change-badge";
import { ForecastChart } from "@/components/agri/charts/forecast-chart";
import { ColumnChart, DivergingBars, SegmentedBar, Sparkline, VizCard } from "@/components/agri/charts/viz";
import { CommodityAvatar } from "@/components/agri/commodity-avatar";
import { DataFreshness } from "@/components/agri/data-freshness";
import { EmptyState } from "@/components/agri/empty-state";
import { PriceCell } from "@/components/agri/price-cell";
import { StatCard } from "@/components/agri/stat-card";
import { buttonVariants, Card, CardTitle, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import type { S } from "@/lib/api/browser";
import {
  useAlertInsights, useCommodities, useFarmingProfile, useForecast, useHistory, useHistoryMany, useInterests, useLatestMany, useMe, useNotifications,
  useSnapshot, useTrending, useUnreadCount,
} from "@/lib/api/queries";
import { money, number, relativeTime, shortDate } from "@/lib/format";
import { cn, greetingPeriod, pick } from "@/lib/utils";
import { QueryState } from "./common";

const MAX_CROPS = 6;
/** A weekly move smaller than this counts as steady in the rising/falling split. */
export const STEADY_PCT = 0.5;
const noSubscribe = () => () => {};

/** Rising / falling / steady counts for this week's movers (exported for tests). */
export function moveSplit(items: { changePct: number }[]) {
  const up = items.filter((i) => i.changePct >= STEADY_PCT).length, down = items.filter((i) => i.changePct <= -STEADY_PCT).length;
  return { up, down, steady: items.length - up - down };
}

const pct = (v: number, locale: string) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString(locale, { maximumFractionDigits: 1 })}%`;

/**
 * /app home. Every figure is an API value or a plain summary of API values (median, average of weekly changes), labelled
 * as such; a panel with no data says so instead of showing zeros. Charts animate in and have table views.
 */
export function Dashboard() {
  const t = useTranslations("app");
  const td = useTranslations("dash");
  const me = useMe();
  const cc = me.data?.country ?? "";
  const snapshot = useSnapshot(cc);
  const name = me.data?.fullName?.split(" ")[0] ?? "";
  // The local hour comes from the browser (the server doesn't know the visitor's time zone); null while server-rendering.
  const hour = useSyncExternalStore(noSubscribe, () => new Date().getHours(), () => null);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {me.data && hour !== null ? t("greeting", { period: t(greetingPeriod(hour)), name }) : <Skeleton className="h-8 w-64" />}
          </h1>
          {snapshot.data?.lastUpdatedAt ? <DataFreshness at={snapshot.data.lastUpdatedAt} className="mt-1" /> : null}
        </div>
        <Link href="/app/assistant" className={buttonVariants({ variant: "outline", size: "sm" })}><Sparkles aria-hidden className="size-4" />{td("askAssistant")}</Link>
      </header>

      <section aria-labelledby="snap">
        <h2 id="snap" className="sr-only">{t("snapshot")}</h2>
        <Snapshot q={snapshot} />
      </section>

      <Outlook cc={cc} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <YourCrops cc={cc} />
          <Movers cc={cc} />
        </div>
        <div className="space-y-6">
          <AlertsCard />
          <NotificationsCard />
          <Card>
            <CardTitle>{td("shortcuts")}</CardTitle>
            <ul className="mt-3 space-y-1 text-sm">
              <Shortcut href="/app/markets" icon={<Store className="size-4" />} label={td("compareMarkets")} />
              <Shortcut href="/app/commodities" icon={<Wheat className="size-4" />} label={td("browseCommodities")} />
              <Shortcut href="/app/forecast" icon={<BrainCircuit className="size-4" />} label={t("aiBannerTitle")} />
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Snapshot({ q }: { q: ReturnType<typeof useSnapshot> }) {
  const t = useTranslations("app");
  const td = useTranslations("dash");
  const locale = useLocale();
  return (
    <QueryState q={q} skeleton={<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>}>
      {(s) => (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label={t("commodities")} value={number(s.commodities, locale)} icon={<Wheat className="size-4" />} />
          <StatCard label={t("markets")} value={number(s.markets, locale)} icon={<Store className="size-4" />} />
          <StatCard label={t("regions")} value={number(s.regions, locale)} icon={<MapPin className="size-4" />} />
          <StatCard label={t("records")} value={number(s.priceRecords, locale, { compact: s.priceRecords >= 10_000 })} icon={<Database className="size-4" />}
            footer={s.priceRecordsLast7d != null ? <p className="text-xs text-muted-fg">{td("newThisWeek", { n: number(s.priceRecordsLast7d, locale) })}</p> : undefined} />
        </div>
      )}
    </QueryState>
  );
}

/**
 * The lead chart: six months of the first followed crop's national price, continued by the AI forecast for the farmer's
 * region (P10–P90 band). When the model's guardrails withhold the forecast, the reason is shown, never a guess.
 */
function Outlook({ cc }: { cc: string }) {
  const t = useTranslations("app");
  const td = useTranslations("dash");
  const locale = useLocale();
  const interests = useInterests();
  const profile = useFarmingProfile();
  const commodities = useCommodities(cc);
  const lead = interests.data?.commodityIds?.[0] ?? "";
  const region = profile.data?.regionId ?? undefined;
  const history = useHistory(lead, cc, "6M");
  const forecast = useForecast(lead, { region });
  const crop = pick(commodities.data?.data.find((c) => c.id === lead)?.name, locale);
  if (interests.isPending) return <Skeleton className="h-80" />;
  if (!lead) return null;
  const h = history.data;
  const f = forecast.data;
  const available = f?.status === "available";
  const horizons = available ? f.horizons.filter((x) => x.status === "available") : [];
  const reasons = f && !available ? (f.reasons ?? []) : [];
  return (
    <VizCard title={td("outlookTitle", { crop: crop || "…" })} fetching={history.isFetching && !history.isPending}
      subtitle={available ? td("outlookAi") : region ? td("outlookHistory") : td("outlookNoRegion")}
      action={<Link href={`/app/commodities/${lead}`} className="rounded-lg px-2 py-1 text-xs font-semibold text-brand hover:bg-muted">{t("seeAll")}</Link>}>
      {history.isPending ? <Skeleton className="h-64" /> : !h?.points.length ? (
        <EmptyState icon={LineIcon} title={td("noHistory")} className="border-none py-6" />
      ) : (
        <div className="space-y-3">
          <ForecastChart history={h.points} horizons={horizons} currency={h.currency} unit={h.unit} title={crop} height={260} />
          {reasons.length ? (
            <p className="flex items-start gap-2 rounded-xl bg-info p-3 text-sm">
              <BrainCircuit aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
              <span><span className="font-semibold">{t("insufficient")}.</span> {reasons.map((r) => t(`reasons.${r}` as "reasons.no_forecast")).join(" ")}</span>
            </p>
          ) : null}
          {available && horizons.length ? (
            <ul className="grid gap-2 sm:grid-cols-3">
              {horizons.map((x) => (
                <li key={x.horizonMonths} className="rounded-xl border border-border p-3">
                  <p className="text-xs text-muted-fg">{t("horizon", { months: x.horizonMonths })} · {shortDate(x.targetDate, locale, { month: "short", year: "numeric" })}</p>
                  <p className="text-lg font-semibold">{money(x.p50, f.currency ?? h.currency, locale)}</p>
                  <p className="text-xs text-muted-fg">{td("likelyBetween", { low: money(x.p10, f.currency ?? h.currency, locale), high: money(x.p90, f.currency ?? h.currency, locale) })}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </VizCard>
  );
}

/** Followed crops: median latest price across reporting markets, average weekly change, and a 3-month weekly trend line. */
function YourCrops({ cc }: { cc: string }) {
  const td = useTranslations("dash");
  const locale = useLocale();
  const interests = useInterests();
  const commodities = useCommodities(cc);
  const ids = (interests.data?.commodityIds ?? []).slice(0, MAX_CROPS);
  const latest = useLatestMany(ids, cc);
  const trend = useHistoryMany(ids, cc, "3M", undefined, "week");
  const loading = interests.isPending || commodities.isPending;

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <CardTitle>{td("yourCrops")}</CardTitle>
        {ids.length ? <Link href="/app/onboarding" className="text-sm font-semibold text-brand hover:underline">{td("editCrops")}</Link> : null}
      </div>
      {loading ? <Skeleton className="h-40" /> : !ids.length ? (
        <EmptyState icon={Wheat} title={td("yourCrops")} description={td("yourCropsEmpty")}
          action={<Link href="/app/onboarding" className={buttonVariants({ size: "sm" })}>{td("chooseCrops")}</Link>} className="border-none py-6" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {ids.map((id, i) => {
            const c = commodities.data?.data.find((x) => x.id === id);
            const s = summarise(latest[i]?.data ?? []);
            const name = pick(c?.name, locale);
            const pts = trend[i]?.data?.points ?? [];
            return (
              <li key={id} className="viz-fade" style={{ ["--i" as string]: i }}>
                <Link href={`/app/commodities/${id}`} className="flex flex-col gap-3 rounded-xl border border-border p-3 transition hover:border-brand hover:shadow-elev-1">
                  <div className="flex items-center gap-3">
                    <CommodityAvatar name={name || "?"} imageUrl={c?.imageUrl} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{name}</p>
                      {latest[i]?.isPending ? <Skeleton className="mt-1 h-4 w-24" /> : s ? (
                        <p className="text-sm"><PriceCell amount={s.median} currency={s.currency} unit={s.unit} /> <span className="text-xs text-muted-fg">· {td("medianAcross", { n: s.n })}</span></p>
                      ) : <p className="text-sm text-muted-fg">{td("noPriceYet")}</p>}
                    </div>
                    {s ? <ChangeBadge value={s.change} /> : null}
                  </div>
                  {pts.length >= 2 ? (
                    <div className="flex items-end justify-between gap-2">
                      <Sparkline values={pts.map((p) => Number(p.avg))} width={180} height={40} />
                      <span className="text-[11px] text-muted-fg">{td("last3Months")}</span>
                    </div>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function summarise(rows: S["MarketPrice"][]) {
  if (!rows.length) return null;
  const vals = rows.map((r) => Number(r.value.display.amount)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!vals.length) return null;
  const mid = Math.floor(vals.length / 2);
  const median = vals.length % 2 ? vals[mid]! : (vals[mid - 1]! + vals[mid]!) / 2;
  const changes = rows.map((r) => r.changePctWoW).filter((x): x is number => x != null && Number.isFinite(x));
  return {
    median, n: vals.length, currency: rows[0]!.value.display.currency, unit: rows[0]!.value.display.unit,
    change: changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : null,
  };
}

/** This week's biggest movers as diverging bars around zero, plus the rising / steady / falling split. */
function Movers({ cc }: { cc: string }) {
  const t = useTranslations("app");
  const td = useTranslations("dash");
  const locale = useLocale();
  const trending = useTrending(cc);
  const items = trending.data ?? [];
  const split = moveSplit(items);
  return (
    <VizCard title={t("trending")} subtitle={td("moversSub")} fetching={trending.isFetching && !trending.isPending}
      action={<Link href="/app/commodities" className="rounded-lg px-2 py-1 text-xs font-semibold text-brand hover:bg-muted">{t("seeAll")}</Link>}
      table={items.length ? { caption: t("trending"), columns: [td("crop"), td("price"), td("weekChange")],
        rows: items.map((i) => [pick(i.commodityName, locale), money(i.current, i.currency, locale), pct(i.changePct, locale)]) } : undefined}>
      <QueryState q={trending} empty={(d) => !d.length}>
        {(list) => (
          <div className="space-y-5">
            <SegmentedBar label={td("moveSplit")} format={(v) => number(v, locale)} parts={[
              { key: "up", name: td("rising", { n: split.up }), value: split.up, color: "var(--viz-pos)" },
              { key: "steady", name: td("steady", { n: split.steady }), value: split.steady, color: "var(--viz-mid)" },
              { key: "down", name: td("falling", { n: split.down }), value: split.down, color: "var(--viz-neg)" },
            ]} />
            <DivergingBars format={(v) => pct(v, locale)}
              rows={[...list].sort((a, b) => b.changePct - a.changePct).map((i) => ({
                key: i.commodityId, label: pick(i.commodityName, locale), value: i.changePct, href: `/app/commodities/${i.commodityId}`,
                sub: `${money(i.current, i.currency, locale)} / ${i.unit}${i.marketsReporting ? ` · ${td("reporting", { n: i.marketsReporting })}` : ""}`,
              }))}
              renderLink={(r, body) => <Link href={r.href!} className="block rounded-lg hover:bg-muted">{body}</Link>} />
          </div>
        )}
      </QueryState>
    </VizCard>
  );
}

function AlertsCard() {
  const t = useTranslations("app");
  const td = useTranslations("dash");
  const locale = useLocale();
  const insights = useAlertInsights();
  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle className="flex items-center gap-2"><Bell aria-hidden className="size-5 text-brand" />{t("alertsSummary")}</CardTitle>
        <Link href="/app/alerts" className="text-sm font-semibold text-brand hover:underline">{t("manage")}</Link>
      </div>
      <QueryState q={insights} skeleton={<Skeleton className="mt-3 h-20" />}>
        {(i) => i.activeAlerts === 0 ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-muted-fg">{t("activeAlerts", { count: 0 })}</p>
            <Link href="/app/alerts" className={buttonVariants({ size: "sm", variant: "outline" })}>{td("createAlert")}</Link>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-2xl font-semibold">{number(i.activeAlerts, locale)}<span className="ms-1 text-sm font-normal text-muted-fg">{t("activeAlerts", { count: i.activeAlerts }).replace(/^\d+\s*/, "")}</span></p>
            <p className="text-sm text-muted-fg">{td("triggered30d", { n: i.triggered30d })}</p>
            {i.trend30d.some((p) => p.count > 0) ? (
              <ColumnChart height={120} format={(v) => number(v, locale)} summary={td("triggered30d", { n: i.triggered30d })}
                series={[{ key: "n", name: td("triggers"), color: "var(--viz-single)" }]}
                data={i.trend30d.slice(-30).map((p) => ({ key: p.date, label: shortDate(p.date, locale), values: [p.count] }))} />
            ) : null}
            {i.mostFrequent?.commodityName ? <p className="text-sm">{td("mostFrequent", { crop: pick(i.mostFrequent.commodityName, locale) })}</p> : null}
          </div>
        )}
      </QueryState>
    </Card>
  );
}

const CATEGORY_ICON: Record<string, typeof Bell> = { price_alert: Bell, market_update: LineIcon, weather: CloudSun, system: Info, weekly_insight: BrainCircuit };

function NotificationsCard() {
  const td = useTranslations("dash");
  const locale = useLocale();
  const list = useNotifications({ limit: 5 });
  const unread = useUnreadCount();
  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          {td("notifications")}
          {unread.data?.total ? <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-brand-fg">{td("unread", { n: unread.data.total })}</span> : null}
        </CardTitle>
        <Link href="/app/notifications" className="text-sm font-semibold text-brand hover:underline">{td("viewAll")}</Link>
      </div>
      <QueryState q={list} skeleton={<Skeleton className="mt-3 h-32" />}>
        {(page) => !page.data.length ? <p className="mt-3 text-sm text-muted-fg">{td("noNotifications")}</p> : (
          <ul className="mt-3 divide-y divide-border">
            {page.data.map((n) => {
              const Icon = CATEGORY_ICON[n.category] ?? Bell;
              const commodityId = typeof n.data?.commodityId === "string" ? n.data.commodityId : null;
              const body = (
                <div className="flex gap-3 py-2.5">
                  <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", n.read ? "text-muted-fg" : "text-brand")} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm", !n.read && "font-semibold")}>{n.title}</p>
                    <p className="line-clamp-2 text-xs text-muted-fg">{n.body}</p>
                    <p className="mt-0.5 text-[11px] text-muted-fg">{td(`cat_${n.category}` as "cat_system")} · <span suppressHydrationWarning>{relativeTime(n.createdAt, locale)}</span></p>
                  </div>
                </div>
              );
              return <li key={n.id}>{commodityId ? <Link href={`/app/commodities/${commodityId}`} className="block rounded-lg hover:bg-muted">{body}</Link> : body}</li>;
            })}
          </ul>
        )}
      </QueryState>
    </Card>
  );
}

function Shortcut({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-muted">
        <span className="flex items-center gap-2"><span aria-hidden className="text-brand">{icon}</span>{label}</span>
        <ChevronRight aria-hidden className="size-4 text-muted-fg rtl:rotate-180" />
      </Link>
    </li>
  );
}
