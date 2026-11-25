"use client";
import { Heart } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { PriceChart } from "@/components/agri/charts/price-chart";
import { Change } from "@/components/price/change";
import { Badge, Card, CardTitle } from "@/components/ui/primitives";
import { useCommodity, useHistory, useLatest, useMe } from "@/lib/api/queries";
import { formatDate, formatMoney, pick } from "@/lib/utils";
import { QueryState, Segmented } from "./common";
import { ForecastView } from "./forecast";

const TABS = ["overview", "history", "forecast", "markets"] as const;
const RANGES = ["1M", "3M", "6M", "1Y", "ALL"] as const;

export function CommodityDetail({ id }: { id: string }) {
  const t = useTranslations("app");
  const tp = useTranslations("prices");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(TABS).withDefault("overview"));
  const [range, setRange] = useQueryState("range", parseAsStringLiteral(RANGES).withDefault("3M"));
  const commodity = useCommodity(id, cc);
  const latest = useLatest(id, cc);
  const history = useHistory(id, cc, range);

  const prices = (latest.data ?? []).map((l) => Number(l.value.display.amount)).sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : null;
  const disp = latest.data?.[0]?.value.display;
  const avgChange = (() => { const v = (latest.data ?? []).map((l) => l.changePctWoW).filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; })();
  const seasons = commodity.data?.countryProfile?.seasons?.[0];
  const months = (ms?: number[]) => (ms ?? []).map((m) => new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(Date.UTC(2026, m - 1, 1))).join(", ");

  return (
    <div className="space-y-6">
      <QueryState q={commodity}>
        {(c) => (
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">{pick(c.name, locale)}</h1>
              <div className="mt-2 flex items-center gap-3">
                <span className="text-3xl font-bold tabular text-brand">{median != null && disp ? `${formatMoney(median, disp.currency, locale)}/${disp.unit}` : "—"}</span>
                <Change pct={avgChange} /><span className="text-xs text-muted-fg">{tp("change")}</span>
              </div>
            </div>
            <button aria-label="Save to watchlist" className="rounded-full p-2 text-down hover:bg-muted"><Heart className="size-6" /></button>
          </div>
        )}
      </QueryState>

      <Segmented label="Sections" value={tab} onChange={(v) => setTab(v)} options={[
        { value: "overview", label: t("overview") }, { value: "history", label: t("history") }, { value: "forecast", label: t("forecast") }, { value: "markets", label: t("marketsTab") },
      ]} />

      {tab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardTitle>{t("overview")}</CardTitle>
            <QueryState q={commodity}>
              {(c) => (
                <dl className="mt-3 divide-y divide-border text-sm">
                  {([["Perishability", <Badge key="p" className="capitalize">{c.perishability}</Badge>], ["HS code", c.hsCode ?? "—"],
                    ["Planting", months(seasons?.plantingMonths) || "—"], ["Harvest", months(seasons?.harvestMonths) || "—"], ["Lean season", months(seasons?.leanMonths) || "—"]] as const).map(([k, v]) => (
                    <div key={k} className="flex justify-between py-2"><dt className="text-muted-fg">{k}</dt><dd className="font-medium">{v}</dd></div>
                  ))}
                </dl>
              )}
            </QueryState>
          </Card>
          <Card>
            <CardTitle>{tp("sixMonths")}</CardTitle>
            <QueryState q={history}>{(h) => <PriceChart history={h.points} currency={h.currency} unit={h.unit} height={220} title={pick(commodity.data?.name, locale)} />}</QueryState>
          </Card>
        </div>
      )}

      {tab === "history" && (
        <Card className="space-y-4">
          <Segmented label="Range" value={range} onChange={(v) => setRange(v)} options={RANGES.map((r) => ({ value: r, label: r }))} />
          <QueryState q={history}>
            {(h) => (
              <>
                <PriceChart history={h.points} currency={h.currency} unit={h.unit} title={pick(commodity.data?.name, locale)} />
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
                  {([["average", h.stats.average], ["high", h.stats.high], ["low", h.stats.low], ["latest", h.stats.latest]] as const).map(([k, v]) => (
                    <div key={k}><dt className="capitalize text-muted-fg">{tp.has(k) ? tp(k) : k}</dt><dd className="font-semibold tabular">{formatMoney(v, h.currency, locale)}</dd></div>
                  ))}
                  <div><dt className="text-muted-fg">{tp("volatility")}</dt><dd className="font-semibold capitalize">{(h.stats.volatility.label ?? "").replace("_", " ")}</dd></div>
                </dl>
              </>
            )}
          </QueryState>
        </Card>
      )}

      {tab === "forecast" && <ForecastView commodityId={id} embedded />}

      {tab === "markets" && (
        <Card className="overflow-x-auto p-0" tabIndex={0} role="region" aria-label={t("marketsTab")}>
          <QueryState q={latest} empty={(d) => !d.length}>
            {(rows) => (
              <table className="w-full min-w-[32rem] text-sm">
                <thead className="bg-muted text-muted-fg"><tr><th scope="col" className="px-4 py-2 text-start">{tp("market")}</th><th scope="col" className="px-4 py-2 text-end">{tp("price")}</th><th scope="col" className="px-4 py-2 text-end">{tp("change")}</th><th scope="col" className="px-4 py-2 text-end">{tp("updated")}</th></tr></thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.marketId} className="border-t border-border">
                      <th scope="row" className="px-4 py-3 text-start font-medium">{pick(l.marketName, locale)}</th>
                      <td className="px-4 py-3 text-end tabular">{formatMoney(l.value.display.amount, l.value.display.currency, locale)}/{l.value.display.unit}</td>
                      <td className="px-4 py-3 text-end"><Change pct={l.changePctWoW} /></td>
                      <td className="px-4 py-3 text-end text-muted-fg">{formatDate(l.observedAt, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </QueryState>
        </Card>
      )}
    </div>
  );
}
