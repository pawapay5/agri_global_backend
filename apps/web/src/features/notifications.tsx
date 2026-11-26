"use client";
import { BellRing, CheckCheck, CloudSun, Info, LineChart, Settings, Store } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsBoolean, parseAsStringLiteral, useQueryState } from "nuqs";
import { EmptyState } from "@/components/agri/empty-state";
import { RangeTabs } from "@/components/agri/range-tabs";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Button, Card, Skeleton } from "@/components/ui/primitives";
import { Link, useRouter } from "@/i18n/navigation";
import type { S } from "@/lib/api/browser";
import { useInbox, useMarkAllRead, useMarkRead, useUnreadCount } from "@/lib/api/queries";
import { absoluteTime, number, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageTitle } from "./common";

export const CATEGORIES = ["price_alert", "market_update", "weather", "system", "weekly_insight"] as const;
const ICONS = { price_alert: BellRing, market_update: Store, weather: CloudSun, system: Info, weekly_insight: LineChart } as const;
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

/** Where a notification leads, from its deep-link payload; null when it carries nothing we can open (exported for tests). */
export function notificationHref(n: Pick<S["Notification"], "category" | "data">): string | null {
  const d = n.data ?? {};
  if (n.category === "price_alert" && isId(d.alertId)) return "/app/alerts?tab=history";
  if (isId(d.commodityId) && isId(d.marketId)) return `/app/forecast/${d.commodityId}?market=${d.marketId}`;
  if (isId(d.commodityId)) return `/app/commodities/${d.commodityId}`;
  if (isId(d.marketId)) return `/app/markets/map?m=${d.marketId}`;
  return null;
}

/** /app/notifications (mockup: Notifications). Category and unread filter live in the URL. */
export function NotificationsPage() {
  const t = useTranslations("alr");
  const td = useTranslations("dash");
  const locale = useLocale();
  const router = useRouter();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [cat, setCat] = useQueryState("cat", parseAsStringLiteral(CATEGORIES));
  const [unread, setUnread] = useQueryState("unread", parseAsBoolean.withDefault(false));
  const inbox = useInbox({ category: cat ?? undefined, unread });
  const counts = useUnreadCount();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const items = inbox.data?.pages.flatMap((p) => p.data) ?? [];
  const unreadHere = cat ? counts.data?.byCategory?.[cat] ?? 0 : counts.data?.total ?? 0;

  const open = (n: S["Notification"]) => {
    if (!n.read) markRead.mutate(n.id);
    const href = notificationHref(n);
    if (href) router.push(href);
  };

  return (
    <div className="space-y-5">
      <PageTitle title={t("inbox")} subtitle={counts.data ? td("unread", { n: counts.data.total }) : undefined} actions={
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" disabled={!unreadHere || markAll.isPending}
            onClick={() => markAll.mutate(cat ?? undefined, { onSuccess: () => fb.success(t("allRead")), onError: (e) => fb.error(problem(e as never)) })}>
            <CheckCheck aria-hidden className="size-4" />{t("markAllRead")}
          </Button>
          <Link href="/app/settings/notifications" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"><Settings aria-hidden className="size-4" />{t("settings")}</Link>
        </div>
      } />
      <div className="flex flex-wrap items-center gap-4">
        <div className="max-w-full overflow-x-auto">
          <RangeTabs size="sm" label={t("category")} value={cat ?? "all"} onChange={(v) => setCat(v === "all" ? null : v)}
            options={[{ value: "all" as const, label: t("allCategories") }, ...CATEGORIES.map((c) => {
              const n = counts.data?.byCategory?.[c] ?? 0;
              return { value: c, label: n ? `${td(`cat_${c}`)} (${number(n, locale)})` : td(`cat_${c}`) };
            })]} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" role="switch" checked={unread} onChange={(e) => setUnread(e.target.checked || null)} className="size-4 accent-[var(--brand)]" />{t("unreadOnly")}
        </label>
      </div>

      {inbox.isPending ? <Skeleton className="h-72" /> : inbox.isError ? (
        <Card role="alert" className="text-sm">{problem(inbox.error as never)} <button onClick={() => inbox.refetch()} className="ms-2 font-semibold text-brand hover:underline">↻</button></Card>
      ) : !items.length ? (
        <EmptyState icon={CheckCheck} title={cat || unread ? t("inboxEmptyFiltered") : t("inboxEmpty")} />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {items.map((n) => {
              const Icon = ICONS[n.category] ?? Info;
              const href = notificationHref(n);
              return (
                <li key={n.id} className={cn("flex gap-3 px-4 py-3", !n.read && "bg-info/40")}>
                  <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2">
                      {!n.read ? <span className="size-2 shrink-0 rounded-full bg-brand" role="img" aria-label={t("unreadDot")} /> : null}
                      {href ? (
                        <button type="button" onClick={() => open(n)} className="text-start font-semibold hover:text-brand hover:underline">{n.title}</button>
                      ) : <span className="font-semibold">{n.title}</span>}
                    </p>
                    <p className="text-sm text-muted-fg">{n.body}</p>
                    <p className="mt-0.5 text-xs text-muted-fg">
                      {td(`cat_${n.category}`)} · <time dateTime={n.createdAt} title={absoluteTime(n.createdAt, locale)}>{relativeTime(n.createdAt, locale)}</time>
                    </p>
                  </div>
                  {!n.read ? (
                    <button type="button" onClick={() => markRead.mutate(n.id, { onError: (e) => fb.error(problem(e as never)) })} aria-label={`${t("markRead")}: ${n.title}`} title={t("markRead")}
                      className="h-fit rounded-lg p-2 text-muted-fg hover:bg-muted hover:text-foreground"><CheckCheck className="size-4" /></button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {inbox.hasNextPage ? <div className="border-t border-border p-3"><Button variant="outline" size="sm" onClick={() => void inbox.fetchNextPage()} disabled={inbox.isFetchingNextPage}>{t("loadMore")}</Button></div> : null}
        </Card>
      )}
    </div>
  );
}
