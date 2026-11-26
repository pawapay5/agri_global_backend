import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { SellerOffers } from "@/features/seller";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><SellerOffers /></Suspense>;
}
