import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { PlantingInsights } from "@/features/insights-planting";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><PlantingInsights /></Suspense>;
}
