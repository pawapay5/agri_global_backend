import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { ReportsPage } from "@/features/reports";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><ReportsPage /></Suspense>;
}
