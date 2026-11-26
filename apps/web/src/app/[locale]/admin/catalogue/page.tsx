import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { CatalogueEditor } from "@/features/admin-catalogue";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><CatalogueEditor /></Suspense>;
}
