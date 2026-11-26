import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { JoinOrg } from "@/features/org";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><JoinOrg /></Suspense>;
}
