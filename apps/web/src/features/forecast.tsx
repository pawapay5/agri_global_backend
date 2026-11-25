"use client";
import { AlertTriangle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";
import { ForecastChart } from "@/components/agri/charts/forecast-chart";
import { DataFreshness } from "@/components/agri/data-freshness";
import { EmptyState } from "@/components/agri/empty-state";
import { ShapBars } from "@/components/agri/shap-bars";
import { Badge, Card } from "@/components/ui/primitives";
import { useCommodity, useExplanation, useForecast, useHistory, useMarkets, useMe } from "@/lib/api/queries";
import { formatMoney, formatPct, pick } from "@/lib/utils";
import { PageTitle, QueryState } from "./common";

/** Market selector shared by forecast and commodity views; the choice lives in the URL (?market=). */
export function MarketSelect({ cc }: { cc: string }) {
  const t = useTranslations("app");
  const locale = useLocale();
  const markets = useMarkets(cc);
  const [market, setMarket] = useQueryState("market", parseAsString);
  return (
    <select aria-label={t("selectMarket")} value={market ?? ""} onChange={(e) => setMarket(e.target.value || null)}
      className="h-10 rounded-xl border border-border bg-background px-3 text-sm">
      <option value="">{t("selectMarket")}</option>
      {markets.data?.data.map((m) => <option key={m.id} value={m.id}>{pick(m.name, locale)}</option>)}
    </select>
  );
}

const confTone = { high: "up", medium: "forecast", low: "down" } as const;

export function ForecastView({ commodityId, embedded = false }: { commodityId: string; embedded?: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const commodity = useCommodity(commodityId, cc);
  const [market] = useQueryState("market", parseAsString);
  const [horizon, setHorizon] = useQueryState("h", parseAsInteger.withDefault(1));
  const forecast = useForecast(commodityId, { market: market ?? undefined });
  const history = useHistory(commodityId, cc, "6M", market ?? undefined);
  const explanation = useExplanation(forecast.data?.status === "available" ? forecast.data.id : null, (horizon as 1 | 3 | 6) ?? 1);
  const featureLabel = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback.replace(/_/g, " "));

  return (
    <div>
      {!embedded && <PageTitle title={`${pick(commodity.data?.name, locale)} · ${t("nav.forecast")}`} actions={<MarketSelect cc={cc} />} />}
      {embedded && <div className="mb-4"><MarketSelect cc={cc} /></div>}
      {!market ? <Card className="text-sm text-muted-fg">{t("app.selectMarket")}</Card> : (
        <QueryState q={forecast}>
          {(f) => f.status !== "available" ? (
            <EmptyState icon={AlertTriangle} title={t("app.insufficient")} reasons={f.reasons} />
          ) : (
            <div className="grid gap-6 xl:grid-cols-5">
              <Card className="space-y-4 xl:col-span-3">
                <div className="grid grid-cols-3 gap-3">
                  {f.horizons.map((h) => (
                    <button key={h.horizonMonths} onClick={() => setHorizon(h.horizonMonths)} aria-pressed={horizon === h.horizonMonths}
                      className={`rounded-xl border p-3 text-start ${horizon === h.horizonMonths ? "border-brand ring-2 ring-ring" : "border-border"}`}>
                      <p className="text-xs text-muted-fg">{t("app.horizon", { months: h.horizonMonths })}</p>
                      {h.status === "available" ? (
                        <>
                          <p className="text-lg font-bold tabular">{formatMoney(h.p50, f.currency ?? "", locale)}</p>
                          <p className={`text-sm font-semibold ${(h.changePctVsLatest ?? 0) >= 0 ? "text-up" : "text-down"}`}>{formatPct(h.changePctVsLatest)}</p>
                          {h.confidence ? <Badge tone={confTone[h.confidence]} className="mt-1 capitalize">{t("app.confidence")}: {h.confidence}</Badge> : null}
                        </>
                      ) : <p className="mt-1 text-xs text-muted-fg">{t("app.insufficient")}</p>}
                    </button>
                  ))}
                </div>
                <ForecastChart history={history.data?.points ?? []} horizons={f.horizons} currency={f.currency ?? ""} unit={f.unit ?? "kg"}
                  title={`${pick(commodity.data?.name, locale)} · ${t("nav.forecast")}`} />
                <DataFreshness at={f.generatedAt} />
                {(() => {
                  const h = f.horizons.find((x) => x.horizonMonths === horizon);
                  return h?.status === "available" ? (
                    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                      <div><dt className="text-muted-fg">{t("app.range")}</dt><dd className="font-semibold tabular">{formatMoney(h.p10, f.currency ?? "", locale)} – {formatMoney(h.p90, f.currency ?? "", locale)}</dd></div>
                      <div><dt className="text-muted-fg">{t("app.backtestMape")}</dt><dd className="font-semibold tabular">{h.backtestMape != null ? `${h.backtestMape.toFixed(1)}%` : "—"}</dd></div>
                      <div><dt className="text-muted-fg">Model</dt><dd className="font-mono text-xs">{f.modelVersion}</dd></div>
                    </dl>
                  ) : null;
                })()}
              </Card>
              <Card className="xl:col-span-2">
                <QueryState q={explanation}>
                  {(e) => (<><h3 className="mb-3 text-base font-semibold">{t("app.why")}</h3><ShapBars features={e.features} insight={e.insight.text} featureLabel={featureLabel} /></>)}
                </QueryState>
              </Card>
            </div>
          )}
        </QueryState>
      )}
    </div>
  );
}

