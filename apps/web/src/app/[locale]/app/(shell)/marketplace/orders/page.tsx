import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { OrdersList } from "@/features/orders";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><OrdersList /></Suspense>;
}
