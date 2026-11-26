import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { WalletPage } from "@/features/wallet";

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-96" />}><WalletPage /></Suspense>;
}
