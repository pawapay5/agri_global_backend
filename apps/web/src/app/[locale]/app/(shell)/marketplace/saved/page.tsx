import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { SavedListings } from "@/features/marketplace";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><SavedListings /></Suspense>;
}
