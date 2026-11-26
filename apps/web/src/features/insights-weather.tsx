"use client";
import { AlertTriangle, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Info, Sun, type LucideIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { DataFreshness } from "@/components/agri/data-freshness";
import { EmptyState } from "@/components/agri/empty-state";
import { InsightCard } from "@/components/agri/insight-card";
import { Card, Skeleton } from "@/components/ui/primitives";
import { ApiError, type S } from "@/lib/api/browser";
import { useCommodities, useInterests, useMe, useWeather } from "@/lib/api/queries";
import { pctPlain } from "@/lib/format";
import { pick } from "@/lib/utils";
import { PageTitle, UpgradePrompt } from "./common";
import { LocationPicker, useOrigin } from "./location";

/** WMO weather code → icon (decorative: every day also states rain and temperatures in text). Exported for tests. */
export function weatherIcon(code: number | null | undefined): LucideIcon {
  if (code == null) return CloudSun;
  if (code <= 1) return Sun;
  if (code <= 3) return Cloud;
  if (code === 45 || code === 48) return CloudFog;
  if (code >= 51 && code <= 57) return CloudDrizzle;
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return CloudRain;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return CloudSnow;
  if (code >= 95) return CloudLightning;
  return CloudSun;
}

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const;

/** /app/insights/weather (mockup: Weather insights). Origin from the shared picker; advice covers followed crops. */
export function WeatherInsights() {
  const t = useTranslations("ins");
  const me = useMe();
  const cc = me.data?.country ?? "";
  const origin = useOrigin(cc);
  const interests = useInterests();
  const weather = useWeather(origin.lat, origin.lng, (interests.data?.commodityIds ?? []).slice(0, 10));

  return (
    <div className="space-y-5">
      <PageTitle title={t("weatherTitle")} subtitle={origin.label ?? undefined} />
      <Card><LocationPicker origin={origin} idPrefix="wx" /></Card>
      {!origin.has ? <EmptyState icon={CloudSun} title={t("startWeather")} description={t("startWeatherBody")} /> :
        weather.isPending ? <Skeleton className="h-72" /> :
        weather.isError ? (
          weather.error instanceof ApiError && weather.error.status === 402 ? <UpgradePrompt detail={weather.error.detail} /> : (
            <Card role="alert" className="text-sm">{t("weatherDown")} <button onClick={() => weather.refetch()} className="ms-2 font-semibold text-brand hover:underline">↻</button></Card>
          )
        ) : <WeatherBody w={weather.data} cc={cc} />}
    </div>
  );
}

function WeatherBody({ w, cc }: { w: S["WeatherAdvice"]; cc: string }) {
  const t = useTranslations("ins");
  const locale = useLocale();
  const commodities = useCommodities(cc);
  const deg = (v: number) => new Intl.NumberFormat(locale, { style: "unit", unit: "celsius", maximumFractionDigits: 0 }).format(v);
  const mm = (v: number) => new Intl.NumberFormat(locale, { style: "unit", unit: "millimeter", maximumFractionDigits: 1 }).format(v);
  const day = (d: string) => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  const cname = (id?: string | null) => (id ? pick(commodities.data?.data.find((c) => c.id === id)?.name, locale) : "");
  const advice = [...w.advice].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return (
    <div className="space-y-6">
      <section aria-labelledby="wx-days" className="space-y-3">
        <h2 id="wx-days" className="text-lg font-semibold">{t("forecast7")}</h2>
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {w.days.slice(0, 7).map((d) => {
            const Icon = weatherIcon(d.weatherCode);
            return (
              <li key={d.date}>
                <Card className="h-full space-y-1.5 p-3 text-sm">
                  <p className="font-semibold"><time dateTime={d.date}>{day(d.date)}</time></p>
                  <Icon aria-hidden className="size-7 text-brand" />
                  <p className="tabular"><span className="font-semibold">{deg(d.tempMaxC)}</span> <span className="text-muted-fg">/ {deg(d.tempMinC)}</span></p>
                  <p className="text-xs">{t("rain")}: {mm(d.precipitationMm)}{d.precipitationProbabilityPct != null ? <span className="block text-muted-fg">{t("rainChance", { pct: pctPlain(d.precipitationProbabilityPct, locale, 0) })}</span> : null}</p>
                  {d.windMaxKmh != null ? <p className="text-xs text-muted-fg">{t("wind", { kmh: Math.round(d.windMaxKmh) })}</p> : null}
                </Card>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="wx-advice" className="space-y-3">
        <h2 id="wx-advice" className="text-lg font-semibold">{t("advice")}</h2>
        {!advice.length ? <p className="text-sm text-muted-fg">{t("noAdvice")}</p> : (
          <ul className="grid gap-3 md:grid-cols-2">
            {advice.map((a, i) => (
              <li key={`${a.code}-${i}`}>
                <InsightCard className="h-full" icon={a.severity === "info" ? Info : AlertTriangle} tone={a.severity === "info" ? "info" : "caution"}
                  title={`${t(`severity_${a.severity}`)}${cname(a.commodityId) ? ` · ${cname(a.commodityId)}` : ""}`}
                  meta={a.validFrom && a.validTo ? t("validRange", { from: day(a.validFrom), to: day(a.validTo) }) : undefined}>
                  {a.text}
                </InsightCard>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-fg">
        <DataFreshness at={w.fetchedAt} />
        <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className="hover:underline">{t("weatherSource")}</a>
      </div>
    </div>
  );
}
