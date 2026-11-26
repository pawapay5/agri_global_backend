import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { GuideDetail } from "@/features/tools";

async function Body({ params }: { params: PageProps<"/[locale]/app/tools/guides/[id]">["params"] }) {
  const { id } = await params;
  return <GuideDetail id={id} />;
}

export default function Page(props: PageProps<"/[locale]/app/tools/guides/[id]">) {
  return <Suspense fallback={<Skeleton className="h-96" />}><Body params={props.params} /></Suspense>;
}
