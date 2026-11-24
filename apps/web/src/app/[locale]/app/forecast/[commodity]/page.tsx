import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import { ForecastView } from "@/features/forecast";

async function Body({ params }: { params: PageProps<"/[locale]/app/forecast/[commodity]">["params"] }) {
  const { commodity } = await params;
  return <ForecastView commodityId={commodity} />;
}

/** /app/forecast/{commodityId}?market={marketId} — forecast chart with the SHAP panel alongside. */
export default function Page(props: PageProps<"/[locale]/app/forecast/[commodity]">) {
  return <Suspense fallback={<Skeleton className="h-64" />}><Body params={props.params} /></Suspense>;
}
