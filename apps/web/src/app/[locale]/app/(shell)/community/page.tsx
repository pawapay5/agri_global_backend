import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { CommunityFeed } from "@/features/community";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><CommunityFeed /></Suspense>;
}
