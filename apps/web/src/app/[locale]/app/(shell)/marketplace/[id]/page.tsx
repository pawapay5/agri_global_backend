import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { ListingDetail } from "@/features/marketplace";

async function Body({ params }: { params: PageProps<"/[locale]/app/marketplace/[id]">["params"] }) {
  const { id } = await params;
  return <ListingDetail id={id} />;
}

export default function Page(props: PageProps<"/[locale]/app/marketplace/[id]">) {
  return <Suspense fallback={<Skeleton className="h-96" />}><Body params={props.params} /></Suspense>;
}
