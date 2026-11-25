
import type { HistoryPoint, HorizonPoint } from "@/lib/charts";
import type { RegionFeature, RegionValue } from "@/components/agri/region-heatmap";
import type { ShapFeature } from "@/components/agri/shap-bars";
import type { MapMarket } from "@/components/agri/market-map";

export const NOW = Date.parse("2026-11-24T09:00:00Z");
const DAY = 86_400_000;

function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) % 2 ** 32; return seed / 2 ** 32; };
}

/** Weekly averages over `weeks`, ending at NOW, with a gentle seasonal swing. */
export function sampleHistory(weeks = 26, base = 14, seed = 7): HistoryPoint[] {
  const r = rng(seed);
  return Array.from({ length: weeks }, (_, i) => {
    const t = NOW - (weeks - 1 - i) * 7 * DAY;
    const v = base + Math.sin(i / 4) * 1.6 + (r() - 0.5) * 0.9 + i * 0.05;
    return { t: new Date(t).toISOString(), avg: v.toFixed(2) };
  });
}

export function sampleHorizons(last = 15): HorizonPoint[] {
  return [1, 3, 6].map((m, i) => ({
    targetDate: new Date(NOW + m * 30 * DAY).toISOString(),
    status: "available",
    p50: (last * (1 + 0.03 * (i + 1))).toFixed(2),
    p10: (last * (1 - 0.04 * (i + 1))).toFixed(2),
    p90: (last * (1 + 0.09 * (i + 1))).toFixed(2),
  }));
}

export const sampleShap: ShapFeature[] = [
  { feature: "is_lean_season", i18nKey: "forecast.feature.is_lean_season", sharePct: 31, contribution: 0.9, direction: "up" },
  { feature: "rain_anomaly", i18nKey: "forecast.feature.rain_anomaly", sharePct: 22, contribution: -0.6, direction: "down" },
  { feature: "fuel_change_12w", i18nKey: "forecast.feature.fuel_change_12w", sharePct: 18, contribution: 0.5, direction: "up" },
  { feature: "lag_1w", i18nKey: "forecast.feature.lag_1w", sharePct: 15, contribution: 0.4, direction: "up" },
  { feature: "nearby_spread", i18nKey: "forecast.feature.nearby_spread", sharePct: 9, contribution: -0.25, direction: "down" },
  { feature: "holiday_next_2w", i18nKey: "forecast.feature.holiday_next_2w", sharePct: 5, contribution: 0.12, direction: "up" },
];

/** A synthetic 3×3 grid of "regions" (not real boundaries), enough to exercise the heatmap. */
export const sampleRegionsGeo: { features: RegionFeature[] } = {
  features: Array.from({ length: 9 }, (_, i) => {
    const x = -3 + (i % 3) * 1.1, y = 5 + Math.floor(i / 3) * 1.4;
    return { type: "Feature", properties: { code: `R${i + 1}` }, geometry: { type: "Polygon", coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1.3], [x, y + 1.3], [x, y]]] } };
  }),
};

export const sampleRegionValues: RegionValue[] = sampleRegionsGeo.features.map((f, i) => ({
  regionId: `00000000-0000-4000-8000-00000000000${i + 1}`,
  code: f.properties.code,
  name: { en: `Region ${String.fromCharCode(65 + i)}`, fr: `Région ${String.fromCharCode(65 + i)}` },
  avg: i === 4 ? null : (10 + i * 1.3).toFixed(2),
  observations: i === 4 ? 0 : 20 + i * 7,
  marketCount: i === 4 ? 0 : 2 + (i % 3),
}));

export const sampleMarkets: MapMarket[] = [
  { id: "m1", name: { en: "Kumasi Central" }, location: { lat: 6.6885, lng: -1.6244 }, distanceKm: 2.4, price: { amount: "14.20", currency: "GHS", unit: "kg" } },
  { id: "m2", name: { en: "Makola, Accra" }, location: { lat: 5.5497, lng: -0.2096 }, distanceKm: 201.7, price: { amount: "15.80", currency: "GHS", unit: "kg" } },
  { id: "m3", name: { en: "Techiman" }, location: { lat: 7.5833, lng: -1.9333 }, distanceKm: 104.3, price: { amount: "12.90", currency: "GHS", unit: "kg" } },
  { id: "m4", name: { en: "Tamale Central" }, location: { lat: 9.4008, lng: -0.8393 }, distanceKm: 318.0, price: null },
];

export const sampleCommodities = [
  { id: "c1", label: "Tomato" }, { id: "c2", label: "Maize (white)" }, { id: "c3", label: "Yam" }, { id: "c4", label: "Onion" },
];
