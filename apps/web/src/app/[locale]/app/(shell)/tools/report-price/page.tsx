import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { ReportPrice } from "@/features/tools";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><ReportPrice /></Suspense>;
}
