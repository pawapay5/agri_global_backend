"use client";
import { Activity, ArrowDown, ArrowUp, Bell, BellOff, Moon, Pause, Play, Settings, Trash2, Zap } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { AlertForm, type AlertFormValues } from "@/components/agri/alert-form";
import { EmptyState } from "@/components/agri/empty-state";
import { RangeTabs } from "@/components/agri/range-tabs";
import { StatCard } from "@/components/agri/stat-card";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Badge, Button, Card, CardTitle, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import type { S } from "@/lib/api/browser";
import { useAlertHistory, useAlertInsights, useAlerts, useCommodities, useCreateAlert, useDeleteAlert, useMarkets, useMe, useUpdateAlert } from "@/lib/api/queries";
import { absoluteTime, money, number, pct, pctPlain, relativeTime, unitLabel } from "@/lib/format";
import { cn, pick } from "@/lib/utils";
import { PageTitle, QueryState } from "./common";

const TABS = ["rules", "history"] as const;
const FILTERS = ["all", "active", "paused"] as const;

/** "Falls below GHS 12.00/kg", "Moves ±10.0% within 7 days": the rule in words (exported for tests). */
export function describeRule(a: Pick<S["Alert"], "condition" | "threshold"> & Partial<Pick<S["Alert"], "thresholdCurrency" | "thresholdUnit" | "pctWindowDays">>, locale: string, t: (k: string, v?: Record<string, string | number>) => string) {
  if (a.condition === "pct_change") return t("cond_pct_change", { value: `±${pctPlain(Number(a.threshold), locale)}`, days: a.pctWindowDays ?? 7 });
  const value = a.thresholdCurrency ? `${money(a.threshold, a.thresholdCurrency, locale)}${a.thresholdUnit ? `/${unitLabel(a.thresholdUnit)}` : ""}` : number(Number(a.threshold), locale);
  return t(`cond_${a.condition}`, { value });
}

/** /app/alerts (mockups: Alerts, Alert history). Rules and history are tabs in the URL (?tab=). */
export function AlertsPage() {
  const t = useTranslations("alr");
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(TABS).withDefault("rules"));
  return (
    <div className="space-y-6">
      <PageTitle title={t("title")} actions={<Link href="/app/settings/notifications" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"><Settings aria-hidden className="size-4" />{t("settings")}</Link>} />
      <Insights />
      <RangeTabs label={t("title")} value={tab} onChange={(v) => setTab(v === "rules" ? null : v)} options={[{ value: "rules", label: t("rules") }, { value: "history", label: t("history") }]} />
      {tab === "rules" ? <Rules /> : <History />}
    </div>
  );
}

function Insights() {
  const t = useTranslations("alr");
  const locale = useLocale();
  const insights = useAlertInsights();
  return (
    <QueryState q={insights} skeleton={<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>}>
      {(i) => (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label={t("active")} value={number(i.activeAlerts, locale)} icon={<Bell className="size-4" />} />
            <StatCard label={t("triggered30d")} value={number(i.triggered30d, locale)} icon={<Zap className="size-4" />}
              trend={i.trend30d.length > 1 ? i.trend30d.map((d) => d.count) : undefined} footer={<span className="text-xs text-muted-fg">{t("triggeredTotal")}: {number(i.triggeredTotal, locale)}</span>} />
            <StatCard label={t("above")} value={number(i.aboveCount, locale)} icon={<ArrowUp className="size-4" />} />
            <StatCard label={t("below")} value={number(i.belowCount, locale)} icon={<ArrowDown className="size-4" />} />
          </div>
          {i.mostFrequent ? <p className="text-sm text-muted-fg"><Activity aria-hidden className="me-1 inline size-4" />{t("mostFrequent", { name: pick(i.mostFrequent.commodityName, locale), n: i.mostFrequent.count ?? 0 })}</p> : null}
        </div>
      )}
    </QueryState>
  );
}

function Rules() {
  const t = useTranslations("alr");
  const tds = useTranslations("ds");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const alerts = useAlerts();
  const commodities = useCommodities(cc);
  const markets = useMarkets(cc);
  const create = useCreateAlert(), update = useUpdateAlert(), remove = useDeleteAlert();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [filter, setFilter] = useQueryState("show", parseAsStringLiteral(FILTERS).withDefault("all"));
  const [preCommodity] = useQueryState("commodity", parseAsString);
  const [preMarket] = useQueryState("market", parseAsString);
  const name = (id: string) => pick(commodities.data?.data.find((c) => c.id === id)?.name, locale);
  const marketName = (id?: string) => (id ? pick(markets.data?.data.find((m) => m.id === id)?.name, locale) : t("allMarkets"));
  const failed = (e: unknown) => fb.error(problem(e as never));

  const onSubmit = async (v: AlertFormValues) => {
    try {
      await create.mutateAsync({ commodityId: v.commodityId, marketId: v.marketId || undefined, condition: v.condition, threshold: v.threshold, channels: v.channels, priceType: "wholesale", pctWindowDays: 7, cooldownHours: 24, active: true });
      fb.success(t("created"), { title: name(v.commodityId) });
    } catch (e) { failed(e); throw e; }
  };
  const toggle = (a: S["Alert"]) => update.mutate({ id: a.id, body: { active: !(a.active ?? true) } }, {
    onSuccess: () => fb.success((a.active ?? true) ? t("pausedToast") : t("resumedToast"), { title: name(a.commodityId) }), onError: failed,
  });
  const del = async (a: S["Alert"]) => {
    const ok = await fb.confirm({ title: t("deleteTitle"), description: t("deleteBody", { name: `${name(a.commodityId)} · ${marketName(a.marketId)}` }), confirmLabel: t("deleteConfirm"), destructive: true });
    if (ok) remove.mutate(a.id, { onSuccess: () => fb.success(t("deleted")), onError: failed });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="h-fit lg:col-span-2">
        <CardTitle>{t("createTitle")}</CardTitle>
        <div className="mt-4">
          {commodities.isSuccess ? (
            <AlertForm key={`${preCommodity ?? ""}:${preMarket ?? ""}`}
              commodities={commodities.data.data.map((c) => ({ id: c.id, label: pick(c.name, locale) }))}
              markets={(markets.data?.data ?? []).map((m) => ({ id: m.id, label: pick(m.name, locale) }))}
              defaultValues={{ commodityId: preCommodity && commodities.data.data.some((c) => c.id === preCommodity) ? preCommodity : "", marketId: preMarket ?? "" }}
              onSubmit={onSubmit} pending={create.isPending} />
          ) : <Skeleton className="h-80" />}
        </div>
      </Card>
      <Card className="space-y-4 lg:col-span-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{t("rules")}</CardTitle>
          <RangeTabs size="sm" label={t("filter")} value={filter} onChange={(v) => setFilter(v === "all" ? null : v)}
            options={[{ value: "all", label: t("filterAll") }, { value: "active", label: t("filterActive") }, { value: "paused", label: t("filterPaused") }]} />
        </div>
        <QueryState q={alerts} skeleton={<Skeleton className="h-48" />}>
          {(list) => {
            const shown = list.filter((a) => filter === "all" || (filter === "active") === (a.active ?? true));
            if (!list.length) return <EmptyState icon={Bell} title={t("none")} />;
            if (!shown.length) return <p className="py-6 text-center text-sm text-muted-fg">{t("noneFiltered")}</p>;
            return (
              <ul className="divide-y divide-border">
                {shown.map((a) => {
                  const on = a.active ?? true;
                  return (
                    <li key={a.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 py-3", !on && "opacity-70")}>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{name(a.commodityId)} <span className="font-normal text-muted-fg">· {marketName(a.marketId)}</span></p>
                        <p className="text-sm">{describeRule(a, locale, t)}</p>
                        <p className="text-xs text-muted-fg">
                          {a.lastTriggeredAt ? <time dateTime={a.lastTriggeredAt} title={absoluteTime(a.lastTriggeredAt, locale)}>{t("lastTriggered", { time: relativeTime(a.lastTriggeredAt, locale) })}</time> : t("neverTriggered")}
                          {" · "}{a.channels.map((c) => tds(`ch_${c}`)).join(", ")}
                        </p>
                      </div>
                      <Badge tone={on ? "up" : undefined}>{on ? t("on") : t("paused")}</Badge>
                      <div className="flex gap-1">
                        <button type="button" onClick={() => toggle(a)} aria-label={`${on ? t("pause") : t("resume")}: ${name(a.commodityId)}`} title={on ? t("pause") : t("resume")}
                          className="rounded-lg p-2 hover:bg-muted">{on ? <Pause className="size-4" /> : <Play className="size-4" />}</button>
                        <button type="button" onClick={() => void del(a)} aria-label={`${t("delete")}: ${name(a.commodityId)}`} title={t("delete")}
                          className="rounded-lg p-2 text-down hover:bg-down/10"><Trash2 className="size-4" /></button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            );
          }}
        </QueryState>
      </Card>
    </div>
  );
}

function History() {
  const t = useTranslations("alr");
  const ta = useTranslations("app");
  const tds = useTranslations("ds");
  const locale = useLocale();
  const me = useMe();
  const commodities = useCommodities(me.data?.country ?? "");
  const markets = useMarkets(me.data?.country ?? "");
  const alerts = useAlerts();
  const h = useAlertHistory();
  const name = (id?: string | null) => pick(commodities.data?.data.find((c) => c.id === id)?.name, locale);
  const marketName = (id?: string | null) => (id ? pick(markets.data?.data.find((m) => m.id === id)?.name, locale) : t("allMarkets"));
  const unitOf = (alertId: string) => alerts.data?.find((a) => a.id === alertId);

  if (h.isPending) return <Skeleton className="h-64" />;
  if (h.isError) return <Card role="alert" className="text-sm">{ta("error")} <button onClick={() => h.refetch()} className="ms-2 font-semibold text-brand hover:underline">↻</button></Card>;
  const events = h.data.pages.flatMap((p) => p.data);
  if (!events.length) return <EmptyState icon={BellOff} title={t("noHistory")} />;
  return (
    <Card className="space-y-3">
      <ol className="divide-y divide-border">
        {events.map((e) => {
          const rule = unitOf(e.alertId);
          const cur = rule?.thresholdCurrency, unit = rule?.thresholdUnit;
          const fmt = (v: string) => (e.condition === "pct_change" ? pct(Number(v), locale) : cur ? `${money(v, cur, locale)}${unit ? `/${unitLabel(unit)}` : ""}` : number(Number(v), locale));
          const Icon = e.direction === "above" ? ArrowUp : ArrowDown;
          return (
            <li key={e.id} className="flex gap-3 py-3">
              <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", e.direction === "above" ? "text-down" : "text-up")} />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="font-semibold">{name(e.commodityId)} <span className="font-normal text-muted-fg">· {marketName(e.marketId)}</span></p>
                <p className="text-sm">
                  <span className="font-medium">{e.direction === "above" ? t("wentAbove") : t("wentBelow")}</span>{" · "}
                  {e.condition === "pct_change" && e.changePct != null ? pct(e.changePct, locale) : t("observed", { observed: fmt(e.observedValue), threshold: fmt(e.threshold) })}
                </p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-fg">
                  <time dateTime={e.triggeredAt} title={absoluteTime(e.triggeredAt, locale)}>{relativeTime(e.triggeredAt, locale)}</time>
                  <span aria-hidden>·</span>
                  {e.deliveredChannels.length ? t("deliveredVia", { channels: e.deliveredChannels.map((c) => tds(`ch_${c}`)).join(", ") }) : t("notSent")}
                  {e.suppressedReason ? <span className="inline-flex items-center gap-1"><Moon aria-hidden className="size-3.5" />{t(`suppressed_${e.suppressedReason}`)}</span> : null}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {h.hasNextPage ? <Button variant="outline" size="sm" onClick={() => void h.fetchNextPage()} disabled={h.isFetchingNextPage}>{t("loadMore")}</Button> : null}
    </Card>
  );
}
