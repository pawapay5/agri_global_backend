import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { MarketsMapView } from "@/features/markets-map";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><MarketsMapView /></Suspense>;
}
