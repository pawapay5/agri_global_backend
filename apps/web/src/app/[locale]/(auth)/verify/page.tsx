import { setRequestLocale } from "next-intl/server";
import { PageFallback } from "@/components/ui/page-fallback";
import { Suspense } from "react";
import { VerifyForm } from "./verify-form";

async function VerifyPageBody({ params }: Pick<PageProps<"/[locale]/verify">, "params">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Suspense><VerifyForm /></Suspense>;
}

/** Params are read inside Suspense so the shared shell stays instant; generateStaticParams still prerenders the content. */
export default function VerifyPage({ params }: PageProps<"/[locale]/verify">) {
  return <Suspense fallback={<PageFallback />}><VerifyPageBody params={params} /></Suspense>;
}
