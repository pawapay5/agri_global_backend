import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { MarketIntel } from "@/features/market-intel";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><MarketIntel /></Suspense>;
}
