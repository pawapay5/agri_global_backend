import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { AuditLog } from "@/features/admin-platform";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><AuditLog /></Suspense>;
}
