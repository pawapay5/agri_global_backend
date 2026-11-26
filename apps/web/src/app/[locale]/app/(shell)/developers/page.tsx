import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { DevelopersPage } from "@/features/developers";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><DevelopersPage /></Suspense>;
}
