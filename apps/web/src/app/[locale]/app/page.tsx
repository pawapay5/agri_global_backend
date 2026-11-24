import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { Dashboard } from "@/features/dashboard";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-64" />}><Dashboard /></Suspense>;
}
