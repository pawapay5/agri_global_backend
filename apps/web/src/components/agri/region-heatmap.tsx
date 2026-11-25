"use client";
import { useLocale, useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { money, number, unitLabel } from "@/lib/format";
import { cn, pick } from "@/lib/utils";

type Ring = [number, number][];
type Geometry = { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };
export interface RegionFeature { type: "Feature"; properties: { code: string } & Record<string, unknown>; geometry: Geometry }
export interface RegionValue { regionId: string; code: string; name?: Record<string, string>; avg: string | null; observations: number; marketCount?: number }

const BINS = 5;

/** Equal-interval bin (1..5) of a value inside [min, max]; null = no data. */
export function binOf(v: number | null, min: number, max: number): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (max <= min) return 3;
  return Math.min(BINS, Math.max(1, Math.floor(((v - min) / (max - min)) * BINS) + 1));
}

/** Plate carrée projection with latitude correction: fine at national scale and needs no map library. */
function project(features: RegionFeature[], w: number, h: number) {
  const pts = features.flatMap((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates).flat(2) as unknown as [number, number][]);
  const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
  const s = Math.min((w - 8) / ((x1 - x0) * k || 1), (h - 8) / (y1 - y0 || 1));
  const ox = (w - (x1 - x0) * k * s) / 2, oy = (h - (y1 - y0) * s) / 2;
  const P = ([lon, lat]: [number, number]) => `${(ox + (lon - x0) * k * s).toFixed(1)},${(oy + (y1 - lat) * s).toFixed(1)}`;
  const ring = (r: Ring) => `M${r.map(P).join("L")}Z`;
  return (g: Geometry) => (g.type === "Polygon" ? g.coordinates.map(ring) : g.coordinates.flatMap((poly) => poly.map(ring))).join("");
}

/**
 * Regional heatmap: average price per region on a 5-step single-hue ramp (--heat-1..5, validated), with a binned
 * legend in display units and a table twin. Regions without data are a neutral fill and say "No data",
 * never a colour that implies a price.
 */
export function RegionHeatmap({ geojson, values, currency, unit, title, className }: {
  geojson: { features: RegionFeature[] }; values: RegionValue[]; currency: string; unit: string; title: string; className?: string;
}) {
  const t = useTranslations("ds");
  const locale = useLocale();
  const id = useId();
  const [hover, setHover] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const W = 520, H = 560;

  const byCode = useMemo(() => new Map(values.map((v) => [v.code, v])), [values]);
  const nums = values.map((v) => (v.avg == null ? null : Number(v.avg))).filter((v): v is number => v != null && Number.isFinite(v));
  const min = nums.length ? Math.min(...nums) : 0, max = nums.length ? Math.max(...nums) : 0;
  const path = useMemo(() => (geojson.features.length ? project(geojson.features, W, H) : null), [geojson]);
  const edges = Array.from({ length: BINS + 1 }, (_, i) => min + ((max - min) * i) / BINS);
  const f = (v: number | string | null | undefined) => (v == null ? t("heatNoData") : money(v, currency, locale));
  const active = hover ? byCode.get(hover) : undefined;

  return (
    <figure className={cn("space-y-3", className)}>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="group" aria-label={title}>
          {path && geojson.features.map((feat) => {
            const v = byCode.get(feat.properties.code);
            const bin = binOf(v?.avg == null ? null : Number(v.avg), min, max);
            const name = pick(v?.name, locale) || feat.properties.code;
            return (
              <path
                key={feat.properties.code} d={path(feat.geometry)} tabIndex={0} role="img"
                aria-label={`${name}: ${f(v?.avg)}${v ? `, ${t("observations")} ${number(v.observations, locale)}` : ""}`}
                fill={bin ? `var(--heat-${bin})` : "var(--heat-empty)"}
                stroke="var(--chart-surface)" strokeWidth={1.5}
                className="cursor-pointer outline-none hover:brightness-110 focus-visible:[stroke:var(--ring)] focus-visible:[stroke-width:3]"
                onPointerEnter={() => setHover(feat.properties.code)} onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(feat.properties.code)} onBlur={() => setHover(null)}
              />
            );
          })}
        </svg>
        {active ? (
          <div className="pointer-events-none absolute start-2 top-2 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md" role="presentation">
            <p className="font-semibold text-foreground tabular">{f(active.avg)}</p>
            <p className="text-muted-fg">{pick(active.name, locale) || active.code} · {t("observations")} {number(active.observations, locale)}</p>
          </div>
        ) : null}
      </div>

      <figcaption className="space-y-1.5">
        <p className="text-xs text-muted-fg">{t("heatLegend", { unit: `${currency}/${unitLabel(unit)}` })}</p>
        <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-fg" aria-label={t("heatLegend", { unit: `${currency}/${unitLabel(unit)}` })}>
          {nums.length ? Array.from({ length: BINS }, (_, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-3 w-5 rounded-sm" style={{ background: `var(--heat-${i + 1})` }} />
              <span className="tabular">{money(edges[i]!, currency, locale, { compact: true })}–{money(edges[i + 1]!, currency, locale, { compact: true })}</span>
            </li>
          )) : null}
          <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-3 w-5 rounded-sm border border-border" style={{ background: "var(--heat-empty)" }} />{t("heatNoData")}</li>
        </ol>
      </figcaption>

      <button type="button" onClick={() => setShowTable((s) => !s)} aria-expanded={showTable} aria-controls={`${id}-table`} className="text-xs font-semibold text-brand hover:underline">
        {showTable ? t("hideTable") : t("viewTable")}
      </button>
      <div id={`${id}-table`} hidden={!showTable} className="max-h-80 overflow-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <caption className="sr-only">{title}</caption>
          <thead className="sticky top-0 bg-muted text-muted-fg">
            <tr><th scope="col" className="px-3 py-2 text-start font-medium">{t("region")}</th><th scope="col" className="px-3 py-2 text-end font-medium">{currency}/{unitLabel(unit)}</th><th scope="col" className="px-3 py-2 text-end font-medium">{t("observations")}</th></tr>
          </thead>
          <tbody>
            {[...values].sort((a, b) => Number(b.avg ?? -Infinity) - Number(a.avg ?? -Infinity)).map((v) => (
              <tr key={v.regionId} className="border-t border-border">
                <th scope="row" className="px-3 py-1.5 text-start font-normal">{pick(v.name, locale) || v.code}</th>
                <td className="px-3 py-1.5 text-end tabular">{f(v.avg)}</td>
                <td className="px-3 py-1.5 text-end tabular">{number(v.observations, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
