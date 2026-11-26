import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { Messages } from "@/features/messages";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><Messages /></Suspense>;
}
