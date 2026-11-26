import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { WeatherInsights } from "@/features/insights-weather";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><WeatherInsights /></Suspense>;
}
