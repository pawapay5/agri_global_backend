import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { DataExplorer } from "@/features/data-explorer";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><DataExplorer /></Suspense>;
}
