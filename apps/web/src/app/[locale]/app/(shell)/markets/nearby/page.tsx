import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { MarketsNearbyView } from "@/features/markets-nearby";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><MarketsNearbyView /></Suspense>;
}
