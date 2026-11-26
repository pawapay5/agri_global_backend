import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { SeasonalInsights } from "@/features/insights-seasonal";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><SeasonalInsights /></Suspense>;
}
