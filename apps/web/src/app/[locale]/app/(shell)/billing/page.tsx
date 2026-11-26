import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { BillingPage } from "@/features/billing";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><BillingPage /></Suspense>;
}
