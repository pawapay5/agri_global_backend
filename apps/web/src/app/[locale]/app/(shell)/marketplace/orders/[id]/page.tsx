import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { OrderDetail } from "@/features/orders";

async function Body({ params }: { params: PageProps<"/[locale]/app/marketplace/orders/[id]">["params"] }) {
  const { id } = await params;
  return <OrderDetail id={id} />;
}

export default function Page(props: PageProps<"/[locale]/app/marketplace/orders/[id]">) {
  return <Suspense fallback={<Skeleton className="h-96" />}><Body params={props.params} /></Suspense>;
}
