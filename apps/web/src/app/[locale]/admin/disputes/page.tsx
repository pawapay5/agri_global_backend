import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { AdminDisputes } from "@/features/admin-moderation";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><AdminDisputes /></Suspense>;
}
