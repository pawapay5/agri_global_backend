import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { OrgPage } from "@/features/org";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><OrgPage /></Suspense>;
}
