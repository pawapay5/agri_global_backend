import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { MarketsCompare } from "@/features/markets-compare";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-64" />}><MarketsCompare /></Suspense>;
}
