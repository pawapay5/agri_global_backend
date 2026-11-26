"use client";
import { Heart, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsString, useQueryState } from "nuqs";
import { ChangeBadge } from "@/components/agri/change-badge";
import { CommodityAvatar } from "@/components/agri/commodity-avatar";
import { EmptyState } from "@/components/agri/empty-state";
import { PriceCell } from "@/components/agri/price-cell";
import { RangeTabs } from "@/components/agri/range-tabs";
import { Card, Input, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import type { S } from "@/lib/api/browser";
import { useCategories, useCommodities, useInterests, useLatestMany, useMe } from "@/lib/api/queries";
import { pick } from "@/lib/utils";
import { PageTitle, QueryState } from "./common";

/** Prices are fetched for the first N visible cards only, so a long catalogue doesn't fan out into 100 requests. */
const PRICED = 24;

/** Median latest price across reporting markets + mean week-on-week change: a plain summary of API values. */
export function summarisePrices(rows: S["MarketPrice"][] | undefined) {
  if (!rows?.length) return null;
  const vals = rows.map((r) => Number(r.value.display.amount)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!vals.length) return null;
  const mid = Math.floor(vals.length / 2);
  const median = vals.length % 2 ? vals[mid]! : (vals[mid - 1]! + vals[mid]!) / 2;
  const changes = rows.map((r) => r.changePctWoW).filter((x): x is number => x != null && Number.isFinite(x));
  const latestAt = rows.reduce((a, r) => (r.observedAt > a ? r.observedAt : a), rows[0]!.observedAt);
  return {
    median, n: vals.length, currency: rows[0]!.value.display.currency, unit: rows[0]!.value.display.unit, latestAt,
    change: changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : null,
  };
}

/**
 * Commodity catalogue (mockup: Commodities). Category filter and search live in the URL (?cat=, ?q=); crops the
 * user follows come first. `target` decides where a card links: the detail page or straight to the forecast.
 */
export function CommodityList({ target }: { target: "detail" | "forecast" }) {
  const t = useTranslations();
  const tc = useTranslations("cmd");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const list = useCommodities(cc);
  const categories = useCategories();
  const interests = useInterests();
  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  const [cat, setCat] = useQueryState("cat", parseAsString.withDefault("all"));
  const followed = new Set(interests.data?.commodityIds ?? []);

  const all = list.data?.data ?? [];
  const usedCats = (categories.data ?? []).filter((c) => all.some((x) => x.categoryId === c.id)).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const needle = q.trim().toLowerCase();
  const items = all
    .filter((c) => cat === "all" || c.categoryId === cat)
    .filter((c) => !needle || pick(c.name, locale).toLowerCase().includes(needle) || c.code.toLowerCase().includes(needle))
    .sort((a, b) => Number(followed.has(b.id)) - Number(followed.has(a.id)) || pick(a.name, locale).localeCompare(pick(b.name, locale), locale));
  const prices = useLatestMany(items.slice(0, PRICED).map((c) => c.id), cc);

  return (
    <div className="space-y-5">
      <PageTitle title={target === "forecast" ? t("nav.forecast") : t("nav.commodities")} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative block w-full max-w-sm">
          <Search aria-hidden className="absolute start-3 top-2.5 size-5 text-muted-fg" />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value || null)} className="ps-10" placeholder={tc("search")} aria-label={tc("search")} />
        </label>
        {usedCats.length > 1 ? (
          <RangeTabs size="sm" label={t("prices.commodity")} value={cat} onChange={(v) => setCat(v === "all" ? null : v)}
            options={[{ value: "all", label: tc("allCategories") }, ...usedCats.map((c) => ({ value: c.id, label: pick(c.name, locale) || c.code }))]} />
        ) : null}
      </div>
      <QueryState q={list} skeleton={<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>}>
        {() => !items.length ? (
          <EmptyState title={needle ? tc("noMatch", { q }) : undefined} />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((c, i) => {
              const p = i < PRICED ? prices[i] : undefined;
              const s = summarisePrices(p?.data);
              const name = pick(c.name, locale);
              return (
                <li key={c.id}>
                  <Link href={target === "forecast" ? `/app/forecast/${c.id}` : `/app/commodities/${c.id}`}
                    className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Card className="flex items-center gap-3 transition-shadow hover:shadow-md">
                      <CommodityAvatar name={name} imageUrl={c.imageUrl} />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 font-semibold">
                          <span className="truncate">{name}</span>
                          {followed.has(c.id) ? <Heart aria-label={tc("following")} className="size-3.5 shrink-0 fill-current text-down" /> : null}
                        </p>
                        {p?.isPending ? <Skeleton className="mt-1 h-4 w-28" /> : s ? (
                          <p className="text-sm"><PriceCell amount={s.median} currency={s.currency} unit={s.unit} size="sm" /> <span className="text-xs text-muted-fg">· {tc("median", { n: s.n })}</span></p>
                        ) : <p className="text-xs text-muted-fg">{i < PRICED ? tc("noRecentPrice") : tc(`perish_${c.perishability}`)}</p>}
                      </div>
                      {s ? <ChangeBadge value={s.change} /> : null}
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </div>
  );
}
