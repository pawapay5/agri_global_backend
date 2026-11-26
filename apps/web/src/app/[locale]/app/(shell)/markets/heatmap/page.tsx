import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { MarketsHeatmapView } from "@/features/markets-heatmap";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><MarketsHeatmapView /></Suspense>;
}
