import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { PostDetail } from "@/features/community";

async function Body({ params }: { params: PageProps<"/[locale]/app/community/posts/[id]">["params"] }) {
  const { id } = await params;
  return <PostDetail id={id} />;
}

export default function Page(props: PageProps<"/[locale]/app/community/posts/[id]">) {
  return <Suspense fallback={<Skeleton className="h-96" />}><Body params={props.params} /></Suspense>;
}
