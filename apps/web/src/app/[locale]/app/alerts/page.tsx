import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { AlertsPage } from "@/features/alerts";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-64" />}><AlertsPage /></Suspense>;
}
