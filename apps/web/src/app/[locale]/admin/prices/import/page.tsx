import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { PriceImport } from "@/features/admin-prices";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><PriceImport /></Suspense>;
}
