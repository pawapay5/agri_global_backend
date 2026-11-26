import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { ModerationQueue } from "@/features/admin-moderation";

export default function Page() {
  return <Suspense fallback={<Skeleton className="m-8 h-96" />}><ModerationQueue /></Suspense>;
}
