import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { PestDetail } from "@/features/tools";

async function Body({ params }: { params: PageProps<"/[locale]/app/tools/pests/[id]">["params"] }) {
  const { id } = await params;
  return <PestDetail id={id} />;
}

export default function Page(props: PageProps<"/[locale]/app/tools/pests/[id]">) {
  return <Suspense fallback={<Skeleton className="h-96" />}><Body params={props.params} /></Suspense>;
}
