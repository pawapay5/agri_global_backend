import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { PriceReview } from "@/features/admin-prices";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><PriceReview /></Suspense>;
}
