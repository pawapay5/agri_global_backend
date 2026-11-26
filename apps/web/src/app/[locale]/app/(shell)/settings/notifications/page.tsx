import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { NotificationSettings } from "@/features/notification-settings";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><NotificationSettings /></Suspense>;
}
