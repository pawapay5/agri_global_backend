"use client";
import type { HistoryPoint, HorizonPoint } from "@/lib/charts";
import { TimeSeriesChart } from "./time-series-chart";

/**
 * History (solid green) continuing into the forecast (dashed orange) with its P10–P90 band and a "Today" divider.
 * Horizons the API marks unavailable are skipped, never drawn as guesses.
 */
export function ForecastChart(props: { history: HistoryPoint[]; horizons: HorizonPoint[]; currency: string; unit: string; title: string; height?: number; today?: number; className?: string }) {
  return <TimeSeriesChart {...props} />;
}
