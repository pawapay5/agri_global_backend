import type { ReactNode } from "react";
import { InsightsNav } from "@/features/insights-nav";

/** Every insight view shares the sub-navigation (Overview · Seasonal · Recommendations · Weather · Planting · Export). */
export default function InsightsLayout({ children }: { children: ReactNode }) {
  return <><InsightsNav />{children}</>;
}
