import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { RecommendationsView } from "@/features/insights-recommendations";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><RecommendationsView /></Suspense>;
}
