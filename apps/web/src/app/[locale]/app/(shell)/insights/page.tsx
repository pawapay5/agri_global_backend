import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { InsightsHub } from "@/features/insights-nav";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><InsightsHub /></Suspense>;
}
