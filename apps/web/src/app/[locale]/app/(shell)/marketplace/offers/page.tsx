import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { BuyerOffers } from "@/features/cart";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><BuyerOffers /></Suspense>;
}
