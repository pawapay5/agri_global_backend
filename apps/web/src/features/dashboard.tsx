"use client";
import { BarChart3, Bell, BrainCircuit, ChevronRight, CloudSun, Database, Info, LineChart, MapPin, ShieldCheck, Store, Wheat } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSyncExternalStore, type ReactNode } from "react";
import { ChangeBadge } from "@/components/agri/change-badge";
import { CommodityAvatar } from "@/components/agri/commodity-avatar";
import { DataFreshness } from "@/components/agri/data-freshness";
import { EmptyState } from "@/components/agri/empty-state";
import { PriceCell } from "@/components/agri/price-cell";
import { StatCard } from "@/components/agri/stat-card";
import { buttonVariants, Card, CardTitle, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import type { S } from "@/lib/api/browser";
import { useAlertInsights, useCommodities, useInterests, useLatestMany, useMe, useNotifications, useSnapshot, useTrending, useUnreadCount } from "@/lib/api/queries";
import { number, relativeTime } from "@/lib/format";
import { cn, greetingPeriod, pick } from "@/lib/utils";
import { QueryState } from "./common";

const MAX_CROPS = 6;
const noSubscribe = () => () => {};

/**
 * /app home (mockup: Home dashboard). Every figure is an API value or a plain summary of API values (median,
 * average of weekly changes), labelled as such; a panel with no data says so instead of showing zeros.
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
      </header>

      <section aria-labelledby="snap">
        <h2 id="snap" className="sr-only">{t("snapshot")}</h2>
        <Snapshot q={snapshot} />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <YourCrops cc={cc} />
          <Trending cc={cc} />
        </div>
        <div className="space-y-6">
          <AlertsCard />
          <NotificationsCard />
          <Link href="/app/forecast" className="block">
            <Card className="flex items-center gap-3 bg-info transition hover:ring-2 hover:ring-[var(--ring)]">
              <BrainCircuit aria-hidden className="size-8 shrink-0 text-brand" />
              <div className="flex-1"><p className="font-semibold">{t("aiBannerTitle")}</p><p className="text-sm text-muted-fg">{t("aiBannerBody")}</p></div>
              <ChevronRight aria-hidden className="size-5 rtl:rotate-180" />
            </Card>
          </Link>
          <Card>
            <CardTitle>{td("shortcuts")}</CardTitle>
            <ul className="mt-3 space-y-1 text-sm">
              <Shortcut href="/app/markets" icon={<BarChart3 className="size-4" />} label={td("compareMarkets")} />
              <Shortcut href="/app/commodities" icon={<Wheat className="size-4" />} label={td("browseCommodities")} />
              <Shortcut href="/app/settings/security" icon={<ShieldCheck className="size-4" />} label={td("security")} />
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

/** The user's followed crops (onboarding interests): median latest price across reporting markets + average weekly change. */
function YourCrops({ cc }: { cc: string }) {
  const td = useTranslations("dash");
  const locale = useLocale();
  const interests = useInterests();
  const commodities = useCommodities(cc);
  const ids = (interests.data?.commodityIds ?? []).slice(0, MAX_CROPS);
  const latest = useLatestMany(ids, cc);
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
            const rows = latest[i]?.data ?? [];
            const s = summarise(rows);
            const name = pick(c?.name, locale);
            return (
              <li key={id}>
                <Link href={`/app/commodities/${id}`} className="flex items-center gap-3 rounded-xl border border-border p-3 transition hover:border-brand">
                  <CommodityAvatar name={name || "?"} imageUrl={c?.imageUrl} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{name}</p>
                    {latest[i]?.isPending ? <Skeleton className="mt-1 h-4 w-24" /> : s ? (
                      <p className="text-sm"><PriceCell amount={s.median} currency={s.currency} unit={s.unit} /> <span className="text-xs text-muted-fg">· {td("medianAcross", { n: s.n })}</span></p>
                    ) : <p className="text-sm text-muted-fg">{td("noPriceYet")}</p>}
                  </div>
                  {s ? <ChangeBadge value={s.change} /> : null}
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

function Trending({ cc }: { cc: string }) {
  const t = useTranslations("app");
  const td = useTranslations("dash");
  const locale = useLocale();
  const trending = useTrending(cc);
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between"><CardTitle>{t("trending")}</CardTitle><Link href="/app/commodities" className="text-sm font-semibold text-brand hover:underline">{t("seeAll")}</Link></div>
      <QueryState q={trending} empty={(d) => !d.length}>
        {(items) => (
          <ul className="divide-y divide-border">
            {items.map((i) => (
              <li key={i.commodityId}>
                <Link href={`/app/commodities/${i.commodityId}`} className="flex items-center justify-between gap-4 py-3 hover:text-brand">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{pick(i.commodityName, locale)}</span>
                    {i.marketsReporting ? <span className="text-xs text-muted-fg">{td("reporting", { n: i.marketsReporting })}</span> : null}
                  </span>
                  <span className="flex items-center gap-4">
                    <PriceCell amount={i.current} currency={i.currency} unit={i.unit} />
                    <ChangeBadge value={i.changePct} className="w-20 justify-end" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </Card>
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
          <div className="mt-3 space-y-2">
            <div className="flex items-end justify-between gap-3">
              <p className="text-2xl font-semibold">{number(i.activeAlerts, locale)}<span className="ms-1 text-sm font-normal text-muted-fg">{t("activeAlerts", { count: i.activeAlerts }).replace(/^\d+\s*/, "")}</span></p>
              <AlertTrend points={i.trend30d} />
            </div>
            <p className="text-sm text-muted-fg">{td("triggered30d", { n: i.triggered30d })}</p>
            {i.mostFrequent?.commodityName ? <p className="text-sm">{td("mostFrequent", { crop: pick(i.mostFrequent.commodityName, locale) })}</p> : null}
          </div>
        )}
      </QueryState>
    </Card>
  );
}

/** 30-day trigger counts as a tiny bar strip (decorative: the counts are stated in text). */
function AlertTrend({ points }: { points: { date: string; count: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.count));
  if (!points.some((p) => p.count > 0)) return null;
  return (
    <svg width={96} height={28} viewBox="0 0 96 28" aria-hidden>
      {points.slice(-30).map((p, i, a) => {
        const w = 96 / a.length, h = Math.max(1, (p.count / max) * 26);
        return <rect key={p.date} x={i * w + 0.5} y={28 - h} width={Math.max(1, w - 1)} height={h} rx={1} fill={p.count ? "var(--chart-history)" : "var(--chart-grid)"} />;
      })}
    </svg>
  );
}

const CATEGORY_ICON: Record<string, typeof Bell> = { price_alert: Bell, market_update: LineChart, weather: CloudSun, system: Info, weekly_insight: BrainCircuit };

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
