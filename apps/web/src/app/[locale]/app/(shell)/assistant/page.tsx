import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { Assistant } from "@/features/assistant";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><Assistant /></Suspense>;
}
