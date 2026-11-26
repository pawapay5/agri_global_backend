import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { AdminUsers } from "@/features/admin-people";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><AdminUsers /></Suspense>;
}
