import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { SellerProfilePage } from "@/features/seller";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><SellerProfilePage /></Suspense>;
}
