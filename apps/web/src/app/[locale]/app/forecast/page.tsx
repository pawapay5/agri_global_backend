import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { CommodityList } from "@/features/commodities";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-64" />}><CommodityList target="forecast" /></Suspense>;
}
