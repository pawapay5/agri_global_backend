import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { SecuritySettings } from "@/features/security";

export default function SecurityPage() {
  return <Suspense fallback={<Skeleton className="h-64" />}><SecuritySettings /></Suspense>;
}
