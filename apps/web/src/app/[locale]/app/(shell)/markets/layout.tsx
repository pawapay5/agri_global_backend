import type { ReactNode } from "react";
import { MarketsNav } from "@/features/markets-nav";

/** Every market view shares the sub-navigation (Compare · Map · Heatmap · Nearby). */
export default function MarketsLayout({ children }: { children: ReactNode }) {
  return <><MarketsNav />{children}</>;
}
