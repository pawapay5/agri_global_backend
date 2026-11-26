import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { Messages } from "@/features/messages";

async function Body({ params }: { params: PageProps<"/[locale]/app/messages/[id]">["params"] }) {
  const { id } = await params;
  return <Messages selectedId={id} />;
}

export default function Page(props: PageProps<"/[locale]/app/messages/[id]">) {
  return <Suspense fallback={<Skeleton className="h-96" />}><Body params={props.params} /></Suspense>;
}
