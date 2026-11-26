import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { ExportInsightsView } from "@/features/insights-export";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><ExportInsightsView /></Suspense>;
}
