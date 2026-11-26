import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { ListingEditor } from "@/features/listing-editor";

async function Body({ params }: { params: PageProps<"/[locale]/app/sell/listings/[id]">["params"] }) {
  const { id } = await params;
  return <ListingEditor id={id} />;
}

export default function Page(props: PageProps<"/[locale]/app/sell/listings/[id]">) {
  return <Suspense fallback={<Skeleton className="h-96" />}><Body params={props.params} /></Suspense>;
}
