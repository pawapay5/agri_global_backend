import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { ListingEditor } from "@/features/listing-editor";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><ListingEditor /></Suspense>;
}
