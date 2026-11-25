import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { CommodityDetail } from "@/features/commodity-detail";

async function Body({ params }: { params: PageProps<"/[locale]/app/commodities/[id]">["params"] }) {
  const { id } = await params;
  return <CommodityDetail id={id} />;
}

export default function Page(props: PageProps<"/[locale]/app/commodities/[id]">) {
  return <Suspense fallback={<Skeleton className="h-64" />}><Body params={props.params} /></Suspense>;
}
