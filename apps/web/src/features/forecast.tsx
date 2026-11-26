"use client";
import { AlertTriangle, MapPin } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";
import { ForecastChart } from "@/components/agri/charts/forecast-chart";
import { ChangeBadge } from "@/components/agri/change-badge";
import { DataFreshness } from "@/components/agri/data-freshness";
import { EmptyState } from "@/components/agri/empty-state";
import { PriceCell } from "@/components/agri/price-cell";
import { ShapBars } from "@/components/agri/shap-bars";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { useCommodity, useExplanation, useForecast, useHistory, useLatest, useMarkets, useMe } from "@/lib/api/queries";
import { relativeTime } from "@/lib/format";
import { cn, pick } from "@/lib/utils";
import { PageTitle, QueryState } from "./common";

/** Market selector shared by forecast and commodity views; the choice lives in the URL (?market=). */
export function MarketSelect({ cc, allLabel }: { cc: string; allLabel?: string }) {
  const t = useTranslations("app");
  const locale = useLocale();
  const markets = useMarkets(cc);
  const [market, setMarket] = useQueryState("market", parseAsString);
  return (
    <select aria-label={t("selectMarket")} value={market ?? ""} onChange={(e) => setMarket(e.target.value || null)}
      className="h-10 max-w-full rounded-xl border border-border bg-background px-3 text-sm">
      <option value="">{allLabel ?? t("selectMarket")}</option>
      {[...(markets.data?.data ?? [])].sort((a, b) => pick(a.name, locale).localeCompare(pick(b.name, locale), locale))
        .map((m) => <option key={m.id} value={m.id}>{pick(m.name, locale)}</option>)}
    </select>
  );
}

const confTone = { high: "up", medium: "forecast", low: "down" } as const;

/**
 * Forecast for one commodity at one market (mockups: Forecast, Why this forecast). Horizons the API withholds
 * are shown as "not published", never estimated; SHAP drivers sit beside the chart for the selected horizon.
 */
export function ForecastView({ commodityId, embedded = false }: { commodityId: string; embedded?: boolean }) {
  const t = useTranslations();
  const tc = useTranslations("cmd");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const commodity = useCommodity(commodityId, cc);
  const markets = useMarkets(cc);
  const [market, setMarket] = useQueryState("market", parseAsString);
  const [horizon, setHorizon] = useQueryState("h", parseAsInteger.withDefault(1));
  const forecast = useForecast(commodityId, { market: market ?? undefined });
  const history = useHistory(commodityId, cc, "6M", market ?? undefined);
  const latest = useLatest(commodityId, cc);
  const explanation = useExplanation(market && forecast.data?.status === "available" ? forecast.data.id : null, ([1, 3, 6].includes(horizon) ? horizon : 1) as 1 | 3 | 6);
  const featureLabel = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback.replace(/_/g, " "));
  const name = pick(commodity.data?.name, locale);
  const marketName = pick(markets.data?.data.find((m) => m.id === market)?.name, locale);
  const title = market && marketName ? tc("forecastFor", { commodity: name, market: marketName }) : `${name} · ${t("nav.forecast")}`;

  const picker = !market ? (
    <Card className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">{tc("pickMarket")}</h2>
        <p className="mt-1 text-sm text-muted-fg">{tc("pickMarketBody")}</p>
      </div>
      <QueryState q={latest} skeleton={<Skeleton className="h-10" />}>
        {(rows) => rows.length ? (
          <ul className="flex flex-wrap gap-2">
            {[...rows].sort((a, b) => (a.observedAt < b.observedAt ? 1 : -1)).slice(0, 12).map((l) => (
              <li key={l.marketId}>
                <button type="button" onClick={() => setMarket(l.marketId)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm hover:border-brand hover:text-brand focus-visible:ring-2 focus-visible:ring-ring outline-none">
                  <MapPin aria-hidden className="size-3.5" />{pick(l.marketName, locale)}
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-fg">{tc("noRecentPrice")}</p>}
      </QueryState>
    </Card>
  ) : null;

  return (
    <div>
      {!embedded && <PageTitle title={title} actions={<MarketSelect cc={cc} />} />}
      {embedded && <div className="mb-4"><MarketSelect cc={cc} /></div>}
      {picker ?? (
        <QueryState q={forecast} skeleton={<Skeleton className="h-96" />}>
          {(f) => f.status !== "available" ? (
            <EmptyState icon={AlertTriangle} title={t("app.insufficient")} reasons={f.reasons} />
          ) : (() => {
            const sel = f.horizons.find((x) => x.horizonMonths === horizon) ?? f.horizons[0];
            const currency = f.currency ?? "", unit = f.unit ?? "kg";
            return (
              <div className="grid gap-6 xl:grid-cols-5">
                <Card className="space-y-5 xl:col-span-3">
                  <div role="group" aria-label={t("app.horizon", { months: sel?.horizonMonths ?? 1 })} className="grid grid-cols-3 gap-2 sm:gap-3">
                    {f.horizons.map((h) => {
                      const on = sel?.horizonMonths === h.horizonMonths;
                      return (
                        <button key={h.horizonMonths} type="button" onClick={() => setHorizon(h.horizonMonths === 1 ? null : h.horizonMonths)} aria-pressed={on}
                          className={cn("rounded-xl border p-3 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", on ? "border-brand bg-brand/5" : "border-border hover:border-brand/50")}>
                          <p className="text-xs text-muted-fg">{tc("horizonCard", { months: h.horizonMonths })}</p>
                          {h.status === "available" ? (
                            <>
                              <p className="mt-0.5"><PriceCell amount={h.p50} currency={currency} unit={unit} size="sm" /></p>
                              <ChangeBadge value={h.changePctVsLatest} period={tc("vsLatest")} className="text-xs" />
                            </>
                          ) : <p className="mt-1 text-xs text-muted-fg">{tc("unavailableHorizon")}</p>}
                        </button>
                      );
                    })}
                  </div>
                  <ForecastChart history={history.data?.points ?? []} horizons={f.horizons} currency={currency} unit={unit} title={title} />
                  {sel?.status === "available" ? (
                    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                      <div><dt className="text-xs text-muted-fg">{tc("likelyRange")}</dt><dd className="font-semibold tabular"><PriceCell amount={sel.p10} currency={currency} unit={unit} size="sm" /> – <PriceCell amount={sel.p90} currency={currency} unit={unit} size="sm" /></dd></div>
                      <div><dt className="text-xs text-muted-fg">{tc("mape")}</dt><dd className="font-semibold tabular">{sel.backtestMape != null ? `${sel.backtestMape.toFixed(1)}%` : "—"}</dd></div>
                      <div><dt className="text-xs text-muted-fg">{t("app.confidence")}</dt><dd>{sel.confidence ? <Badge tone={confTone[sel.confidence]}>{tc(`confidence_${sel.confidence}`)}</Badge> : "—"}</dd></div>
                      <div><dt className="text-xs text-muted-fg">{tc("model")}</dt><dd className="truncate font-mono text-xs" title={f.modelVersion}>{f.modelVersion}</dd></div>
                    </dl>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-fg">
                    <DataFreshness at={f.lastObservedAt ?? history.data?.points.at(-1)?.t} />
                    {f.generatedAt ? <span>{tc("generated", { time: relativeTime(f.generatedAt, locale) })}</span> : null}
                  </div>
                </Card>
                <Card className="xl:col-span-2">
                  <h3 className="mb-3 text-base font-semibold">{t("app.why")}</h3>
                  {sel?.status === "available" ? (
                    <QueryState q={explanation} skeleton={<Skeleton className="h-48" />}>
                      {(e) => <ShapBars features={e.features} insight={e.insight.text} featureLabel={featureLabel} />}
                    </QueryState>
                  ) : <p className="text-sm text-muted-fg">{tc("unavailableHorizon")}</p>}
                </Card>
              </div>
            );
          })()}
        </QueryState>
      )}
    </div>
  );
}
