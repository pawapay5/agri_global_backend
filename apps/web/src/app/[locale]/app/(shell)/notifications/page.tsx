import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { NotificationsPage } from "@/features/notifications";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><NotificationsPage /></Suspense>;
}
