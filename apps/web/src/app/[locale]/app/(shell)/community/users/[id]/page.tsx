import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { CommunityProfilePage } from "@/features/community";

async function Body({ params }: { params: PageProps<"/[locale]/app/community/users/[id]">["params"] }) {
  const { id } = await params;
  return <CommunityProfilePage id={id} />;
}

export default function Page(props: PageProps<"/[locale]/app/community/users/[id]">) {
  return <Suspense fallback={<Skeleton className="h-96" />}><Body params={props.params} /></Suspense>;
}
