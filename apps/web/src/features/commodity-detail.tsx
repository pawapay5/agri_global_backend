"use client";
import { ArrowUpDown, Bell, Heart, LineChart } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useState } from "react";
import { PriceChart } from "@/components/agri/charts/price-chart";
import { ChangeBadge } from "@/components/agri/change-badge";
import { CommodityAvatar } from "@/components/agri/commodity-avatar";
import { CropCalendar } from "@/components/agri/crop-calendar";
import { DataFreshness } from "@/components/agri/data-freshness";
import { EmptyState } from "@/components/agri/empty-state";
import { PriceCell } from "@/components/agri/price-cell";
import { RangeTabs } from "@/components/agri/range-tabs";
import { biggestMonthlyMove, monthName, SeasonalBars } from "@/components/agri/seasonal-bars";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { buttonVariants, Card, CardTitle, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import type { S } from "@/lib/api/browser";
import { useCommodity, useHistory, useInterests, useLatest, useMarkets, useMe, useSeasonal, useToggleFollow } from "@/lib/api/queries";
// Same rules as lib/countries (server-only): ISO2 lower-cased; market code with dashes.
const countrySlug = (iso2: string) => iso2.toLowerCase();
const marketSlug = (code: string) => code.replace(/_/g, "-");
import { absoluteTime, number, pctPlain } from "@/lib/format";
import { cn, pick } from "@/lib/utils";
import { summarisePrices } from "./commodities";
import { QueryState } from "./common";
import { ForecastView, MarketSelect } from "./forecast";

const TABS = ["overview", "history", "forecast", "markets"] as const;
const RANGES = ["1M", "3M", "6M", "1Y", "ALL"] as const;

/**
 * Commodity detail (mockups: Commodity detail, Price history, Forecast). Header figures are a labelled summary
 * of the latest market reports; every tab says so when the API has nothing rather than drawing a guess.
 */
export function CommodityDetail({ id }: { id: string }) {
  const t = useTranslations("app");
  const tc = useTranslations("cmd");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(TABS).withDefault("overview"));
  const commodity = useCommodity(id, cc);
  const latest = useLatest(id, cc);
  const s = summarisePrices(latest.data);
  const name = pick(commodity.data?.name, locale);

  return (
    <div className="space-y-6">
      <QueryState q={commodity} skeleton={<Skeleton className="h-20" />}>
        {(c) => (
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <CommodityAvatar name={name} imageUrl={c.imageUrl} size="lg" />
              <div>
                <h1 className="text-2xl font-bold sm:text-3xl">{name}</h1>
                {latest.isPending ? <Skeleton className="mt-2 h-7 w-48" /> : s ? (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <PriceCell amount={s.median} currency={s.currency} unit={s.unit} size="lg" />
                    <ChangeBadge value={s.change} variant="pill" period={tc("vsLastWeek")} />
                    <span className="text-xs text-muted-fg">{tc("median", { n: s.n })}</span>
                  </div>
                ) : <p className="mt-1 text-sm text-muted-fg">{tc("noRecentPrice")}</p>}
                {s ? <DataFreshness at={s.latestAt} className="mt-1" /> : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <FollowButton id={id} name={name} />
              <Link href={`/app/alerts?commodity=${id}`} className={buttonVariants({ variant: "outline", size: "sm" })}><Bell aria-hidden className="size-4" />{tc("createAlert")}</Link>
            </div>
          </header>
        )}
      </QueryState>

      <RangeTabs label={name || t("overview")} value={tab} onChange={(v) => setTab(v === "overview" ? null : v)} options={[
        { value: "overview", label: t("overview") }, { value: "history", label: t("history") }, { value: "forecast", label: t("forecast") }, { value: "markets", label: t("marketsTab") },
      ]} />

      {tab === "overview" && <Overview id={id} cc={cc} commodity={commodity.data} />}
      {tab === "history" && <History id={id} cc={cc} name={name} />}
      {tab === "forecast" && <ForecastView commodityId={id} embedded />}
      {tab === "markets" && <MarketsTable id={id} cc={cc} rows={latest} />}
    </div>
  );
}

function FollowButton({ id, name }: { id: string; name: string }) {
  const tc = useTranslations("cmd");
  const interests = useInterests();
  const toggle = useToggleFollow();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const on = Boolean(interests.data?.commodityIds?.includes(id));
  return (
    <button type="button" aria-pressed={on} disabled={interests.isPending || toggle.isPending}
      onClick={() => toggle.mutate({ id, follow: !on, current: interests.data }, {
        onSuccess: () => fb.success(on ? tc("unfollowed") : tc("followed"), { title: name }),
        onError: (e) => fb.error(problem(e as never)),
      })}
      className={cn(buttonVariants({ variant: on ? "primary" : "outline", size: "sm" }))}>
      <Heart aria-hidden className={cn("size-4", on && "fill-current")} />{on ? tc("following") : tc("follow")}
    </button>
  );
}

function Overview({ id, cc, commodity }: { id: string; cc: string; commodity: S["CommodityDetail"] | undefined }) {
  const t = useTranslations("app");
  const tc = useTranslations("cmd");
  const tp = useTranslations("prices");
  const locale = useLocale();
  const seasonal = useSeasonal(id, cc);
  const history = useHistory(id, cc, "6M");
  const seasons = commodity?.countryProfile?.seasons?.[0];
  const varieties = (commodity?.countryProfile as { varieties?: string[] } | undefined)?.varieties ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="space-y-4 lg:col-span-2">
        <CardTitle>{tc("profile")}</CardTitle>
        {commodity ? (
          <dl className="divide-y divide-border text-sm">
            {([
              [tc("perishability"), tc(`perish_${commodity.perishability}`)],
              [tc("shelfLife"), commodity.shelfLifeDays != null ? tc("days", { n: number(commodity.shelfLifeDays, locale) }) : null],
              [tc("defaultUnit"), commodity.defaultUnit],
              [tc("hsCode"), commodity.hsCode],
              [tc("varieties"), varieties.length ? varieties.join(", ") : null],
            ] as const).filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-muted-fg">{k}</dt><dd className="text-end font-medium">{v}</dd></div>
            ))}
          </dl>
        ) : <Skeleton className="h-32" />}
        {seasons ? (
          <section aria-labelledby="cal" className="space-y-2">
            <h3 id="cal" className="text-sm font-semibold">{tc("calendarTitle")}</h3>
            <CropCalendar plantingMonths={seasons.plantingMonths} harvestMonths={seasons.harvestMonths} leanMonths={seasons.leanMonths} />
          </section>
        ) : null}
      </Card>
      <div className="space-y-6 lg:col-span-3">
        <Card className="space-y-3">
          <CardTitle>{tc("seasonalTitle")}</CardTitle>
          <QueryState q={seasonal} skeleton={<Skeleton className="h-52" />}>
            {(a) => {
              const move = biggestMonthlyMove(a.avgMonthlyChangePct);
              // With no monthly series there is nothing to explain: show only the chart's own empty state.
              const hasSeries = a.monthlyAverage.some((v) => v != null && Number.isFinite(Number(v)));
              return (
                <>
                  <SeasonalBars monthlyAverage={a.monthlyAverage} peakMonths={a.peakMonths} lowMonths={a.lowMonths} currency={a.currency} unit={a.unit} title={tc("seasonalTitle")} />
                  {!hasSeries ? null : a.insight ? <p className="text-sm">{a.insight}</p> : move ? (
                    <p className="text-sm">{tc("biggestMove", { dir: move.pct >= 0 ? tc("rise") : tc("fall"), pct: pctPlain(move.pct, locale), month: monthName(move.month, locale, "long") })}</p>
                  ) : null}
                  {hasSeries && a.years.length ? <p className="text-xs text-muted-fg">{a.years.map((y) => y.year).join(" · ")}</p> : null}
                </>
              );
            }}
          </QueryState>
        </Card>
        <Card className="space-y-3">
          <CardTitle>{tp("sixMonths")}</CardTitle>
          <QueryState q={history} skeleton={<Skeleton className="h-56" />}>
            {(h) => <PriceChart history={h.points} currency={h.currency} unit={h.unit} height={220} title={`${pick(commodity?.name, locale)} · ${tp("sixMonths")}`} />}
          </QueryState>
          <Link href={`/app/commodities/${id}?tab=history`} className="text-xs font-semibold text-brand hover:underline">{t("history")} →</Link>
        </Card>
      </div>
    </div>
  );
}

function History({ id, cc, name }: { id: string; cc: string; name: string }) {
  const locale = useLocale();
  const tc = useTranslations("cmd");
  const [range, setRange] = useQueryState("range", parseAsStringLiteral(RANGES).withDefault("3M"));
  const [market] = useQueryState("market", parseAsString);
  const history = useHistory(id, cc, range, market ?? undefined);
  return (
    <Card className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangeTabs label={tc("range")} value={range} onChange={(v) => setRange(v === "3M" ? null : v)} options={RANGES.map((r) => ({ value: r, label: r }))} />
        <MarketSelect cc={cc} allLabel={tc("allMarkets")} />
      </div>
      <QueryState q={history} skeleton={<Skeleton className="h-72" />}>
        {(h) => {
          const last = h.points.at(-1);
          const vol = h.stats.volatility?.label;
          return (
            <>
              <PriceChart history={h.points} currency={h.currency} unit={h.unit} title={`${name} · ${range}`} />
              <section aria-label={tc("stats")}>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {([[tc("latest"), h.stats.latest], [tc("average"), h.stats.average], [tc("highest"), h.stats.high], [tc("lowest"), h.stats.low]] as const).map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-muted/60 p-3"><dt className="text-xs text-muted-fg">{k}</dt><dd className="mt-0.5 font-semibold"><PriceCell amount={v} currency={h.currency} unit={h.unit} size="sm" /></dd></div>
                  ))}
                  <div className="rounded-xl bg-muted/60 p-3"><dt className="text-xs text-muted-fg">{tc("volatility")}</dt>
                    <dd className="mt-0.5 font-semibold">{vol ? tc(`vol_${vol}`) : "—"}{h.stats.volatility?.cv != null ? <span className="ms-1 text-xs font-normal text-muted-fg">CV {pctPlain(h.stats.volatility.cv * 100, locale)}</span> : null}</dd></div>
                </dl>
              </section>
              {last ? <DataFreshness at={last.t} /> : null}
            </>
          );
        }}
      </QueryState>
    </Card>
  );
}

type SortKey = "market" | "price" | "change" | "updated";

function MarketsTable({ id, cc, rows }: { id: string; cc: string; rows: ReturnType<typeof useLatest> }) {
  const tp = useTranslations("prices");
  const tc = useTranslations("cmd");
  const locale = useLocale();
  const markets = useMarkets(cc);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "price", dir: -1 });
  const codeOf = new Map((markets.data?.data ?? []).map((m) => [m.id, m.code]));
  const val = (l: S["MarketPrice"], k: SortKey): string | number =>
    k === "market" ? pick(l.marketName, locale) : k === "price" ? Number(l.value.display.amount) : k === "change" ? l.changePctWoW ?? -Infinity : l.observedAt;
  const head = (k: SortKey, label: string, end = true) => (
    <th scope="col" aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={cn("px-4 py-2 font-medium", end ? "text-end" : "text-start")}>
      <button type="button" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : k === "market" ? 1 : -1 }))}
        className="inline-flex items-center gap-1 hover:text-foreground">
        {label}<ArrowUpDown aria-hidden className="size-3.5" />
      </button>
    </th>
  );
  return (
    <QueryState q={rows} skeleton={<Skeleton className="h-64" />}>
      {(data) => !data.length ? <EmptyState title={tc("noRecentPrice")} /> : (
        <Card className="overflow-x-auto p-0" tabIndex={0} role="region" aria-label={tp("market")}>
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">{tp("market")}</caption>
            <thead className="bg-muted text-muted-fg"><tr>{head("market", tp("market"), false)}{head("price", tp("price"))}{head("change", tp("change"))}{head("updated", tp("updated"))}<td /></tr></thead>
            <tbody>
              {[...data].sort((a, b) => { const x = val(a, sort.key), y = val(b, sort.key); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; }).map((l) => {
                const code = codeOf.get(l.marketId);
                return (
                  <tr key={l.marketId} className="border-t border-border">
                    <th scope="row" className="px-4 py-3 text-start font-medium">
                      {code ? <Link href={`/${countrySlug(cc)}/markets/${marketSlug(code)}`} className="hover:text-brand hover:underline">{pick(l.marketName, locale)}</Link> : pick(l.marketName, locale)}
                    </th>
                    <td className="px-4 py-3 text-end"><PriceCell amount={l.value.display.amount} currency={l.value.display.currency} unit={l.value.display.unit} size="sm" /></td>
                    <td className="px-4 py-3 text-end"><ChangeBadge value={l.changePctWoW} /></td>
                    <td className="px-4 py-3 text-end text-muted-fg"><time dateTime={l.observedAt} title={absoluteTime(l.observedAt, locale)}>{new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(l.observedAt))}</time></td>
                    <td className="px-4 py-3 text-end">
                      <Link href={`/app/forecast/${id}?market=${l.marketId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"><LineChart aria-hidden className="size-3.5" />{tc("forecastHere")}</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </QueryState>
  );
}
