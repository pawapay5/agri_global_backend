import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { DisputeView } from "@/features/orders";

async function Body({ params }: { params: PageProps<"/[locale]/app/disputes/[id]">["params"] }) {
  const { id } = await params;
  return <DisputeView id={id} />;
}

export default function Page(props: PageProps<"/[locale]/app/disputes/[id]">) {
  return <Suspense fallback={<Skeleton className="h-96" />}><Body params={props.params} /></Suspense>;
}
