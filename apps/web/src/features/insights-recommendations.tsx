"use client";
import { ArrowRightLeft, Clock, Sprout, TrendingUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsFloat, parseAsNumberLiteral, parseAsString, useQueryState } from "nuqs";
import { useState } from "react";
import { ChangeBadge } from "@/components/agri/change-badge";
import { DataFreshness } from "@/components/agri/data-freshness";
import { EmptyState } from "@/components/agri/empty-state";
import { InsightCard } from "@/components/agri/insight-card";
import { PriceCell } from "@/components/agri/price-cell";
import { RangeTabs } from "@/components/agri/range-tabs";
import { Badge, Card, CardTitle, Input, Label, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import type { S } from "@/lib/api/browser";
import { useAlternativeMarkets, useMarkets, useMe, useRecommendations } from "@/lib/api/queries";
import { number, pct, relativeTime } from "@/lib/format";
import { pick } from "@/lib/utils";
import { PageTitle, QueryState } from "./common";
import { MarketSelect } from "./forecast";
import { publicMarketPath } from "./markets-map";
import { CommodityPicker, useCommodityChoice } from "./markets-nav";

const KIND = {
  sell_now: { icon: TrendingUp, tone: "positive" },
  hold: { icon: Clock, tone: "caution" },
  alternative_market: { icon: ArrowRightLeft, tone: "info" },
  plant: { icon: Sprout, tone: "positive" },
} as const;
const CONF = { high: "up", medium: "forecast", low: "down" } as const;
const RADII = [50, 100, 200, 400] as const;

/** /app/insights/recommendations (mockups: Recommendations, Alternative markets). Needs a commodity and a market. */
export function RecommendationsView() {
  const t = useTranslations("ins");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const choice = useCommodityChoice(cc);
  const [market] = useQueryState("market", parseAsString);
  const markets = useMarkets(cc);
  const recs = useRecommendations(choice.id, market ?? "");
  const marketName = pick(markets.data?.data.find((m) => m.id === market)?.name, locale);

  return (
    <div className="space-y-5">
      <PageTitle title={t("recTitle")} />
      <div className="flex flex-wrap items-end gap-3">
        <CommodityPicker choice={choice} />
        <MarketSelect cc={cc} />
      </div>
      {!market ? <EmptyState icon={ArrowRightLeft} title={t("pickMarketFirst")} /> : (
        <>
          <QueryState q={recs} skeleton={<Skeleton className="h-48" />}>
            {(set) => !set.recommendations.length ? <EmptyState title={t("noRecs")} /> : (
              <section aria-labelledby="recs" className="space-y-3">
                <h2 id="recs" className="sr-only">{t("recTitle")}</h2>
                <ul className="grid gap-4 md:grid-cols-2">
                  {set.recommendations.map((r, i) => <li key={i}><Recommendation r={r} cc={cc} markets={markets.data?.data ?? []} /></li>)}
                </ul>
                <p className="text-xs text-muted-fg">{t("generated", { time: relativeTime(set.generatedAt, locale) })}</p>
              </section>
            )}
          </QueryState>
          <Alternatives commodityId={choice.id} marketId={market} marketName={marketName} cc={cc} />
        </>
      )}
    </div>
  );
}

function Recommendation({ r, cc, markets }: { r: S["Recommendation"]; cc: string; markets: S["Market"][] }) {
  const t = useTranslations("ins");
  const tc = useTranslations("cmd");
  const locale = useLocale();
  const k = KIND[r.kind];
  const target = r.marketId ? markets.find((m) => m.id === r.marketId) : undefined;
  return (
    <InsightCard title={`${t(`kind_${r.kind}`)}: ${r.title}`} icon={k.icon} tone={k.tone} className="h-full"
      meta={
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={CONF[r.confidence]}>{tc(`confidence_${r.confidence}`)}</Badge>
          {r.expectedChangePct != null ? <span>{t("expectedChange", { pct: pct(r.expectedChangePct, locale) })}</span> : null}
          {r.marginPct != null ? <span>{t("margin", { pct: pct(r.marginPct, locale) })}</span> : null}
        </span>
      }
      action={target ? <Link href={publicMarketPath(cc, target.code)} className="text-sm font-semibold text-brand hover:underline">{pick(target.name, locale)}</Link> : undefined}>
      <p>{r.rationale}</p>
      {r.basis.length ? <p className="mt-2 text-xs text-muted-fg">{t("basisLabel")}: {r.basis.map((b) => t(`basis_${b}`)).join(", ")}</p> : null}
    </InsightCard>
  );
}

function Alternatives({ commodityId, marketId, marketName, cc }: { commodityId: string; marketId: string; marketName: string; cc: string }) {
  const t = useTranslations("ins");
  const tp = useTranslations("prices");
  const locale = useLocale();
  const [r, setR] = useQueryState("r", parseAsNumberLiteral(RADII).withDefault(200));
  const [cost, setCost] = useQueryState("cost", parseAsFloat);
  const [draft, setDraft] = useState(cost != null ? String(cost) : "");
  const alt = useAlternativeMarkets(commodityId, marketId, r, cost ?? undefined);
  const currency = alt.data?.[0]?.latest.value.display.currency ?? "";
  const commit = () => { const n = Number(draft.replace(",", ".")); void setCost(draft.trim() && Number.isFinite(n) && n >= 0 ? n : null); };

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <CardTitle>{t("altTitle")}</CardTitle>
          <p className="mt-1 text-sm text-muted-fg">{t("altIntro", { km: r, market: marketName || "—" })}</p>
        </div>
        <RangeTabs size="sm" label={t("radius")} value={String(r) as `${(typeof RADII)[number]}`} onChange={(v) => void setR(Number(v) === 200 ? null : (Number(v) as (typeof RADII)[number]))}
          options={RADII.map((k) => ({ value: String(k) as `${typeof k}`, label: `${k} km` }))} />
      </div>
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="alt-cost">{t("transport", { currency: currency || "—" })}</Label>
        <Input id="alt-cost" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} aria-describedby="alt-cost-hint" />
        <p id="alt-cost-hint" className="text-xs text-muted-fg">{t("transportHint")}</p>
      </div>
      <QueryState q={alt} skeleton={<Skeleton className="h-48" />}>
        {(rows) => !rows.length ? <p className="py-4 text-sm text-muted-fg">{t("noAlternatives", { km: r })}</p> : (
          <div className="overflow-x-auto rounded-xl border border-border" tabIndex={0} role="region" aria-label={t("altTitle")}>
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="sr-only">{t("altTitle")}</caption>
              <thead className="bg-muted text-muted-fg">
                <tr>
                  <th scope="col" className="px-4 py-2 text-start font-medium">{tp("market")}</th>
                  <th scope="col" className="px-4 py-2 text-end font-medium">{tp("price")}</th>
                  <th scope="col" className="px-4 py-2 text-end font-medium">{t("grossMargin")}</th>
                  {cost != null ? <th scope="col" className="px-4 py-2 text-end font-medium">{t("netMargin")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.market.id} className="border-t border-border align-top">
                    <th scope="row" className="px-4 py-3 text-start font-normal">
                      <Link href={publicMarketPath(cc, a.market.code)} className="font-medium hover:text-brand hover:underline">{pick(a.market.name, locale)}</Link>
                      <span className="block text-xs text-muted-fg">{number(a.distanceKm, locale, { digits: 0 })} km</span>
                    </th>
                    <td className="px-4 py-3 text-end"><PriceCell amount={a.latest.value.display.amount} currency={a.latest.value.display.currency} unit={a.latest.value.display.unit} size="sm" /><DataFreshness at={a.latest.observedAt} className="justify-end text-xs" /></td>
                    <td className="px-4 py-3 text-end"><ChangeBadge value={a.grossMarginPct} /></td>
                    {cost != null ? <td className="px-4 py-3 text-end">{a.netMarginPct != null ? <ChangeBadge value={a.netMarginPct} /> : "—"}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </Card>
  );
}
