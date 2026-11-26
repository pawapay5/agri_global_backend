import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { SellerApprovals } from "@/features/admin-kyc";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><SellerApprovals /></Suspense>;
}
