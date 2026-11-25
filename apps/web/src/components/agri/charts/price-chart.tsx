"use client";
import type { HistoryPoint } from "@/lib/charts";
import { TimeSeriesChart } from "./time-series-chart";

/** Price history only: solid green line, end label, crosshair tooltip, table view. */
export function PriceChart(props: { history: HistoryPoint[]; currency: string; unit: string; title: string; height?: number; className?: string }) {
  return <TimeSeriesChart {...props} />;
}
