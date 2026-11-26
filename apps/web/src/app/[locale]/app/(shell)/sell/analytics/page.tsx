import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { SellerAnalytics } from "@/features/seller-analytics";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><SellerAnalytics /></Suspense>;
}
