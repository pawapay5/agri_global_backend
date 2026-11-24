import { setRequestLocale } from "next-intl/server";
import { PageFallback } from "@/components/ui/page-fallback";
import { Suspense } from "react";
import { packCountries } from "@/lib/countries";
import { LoginForm } from "./login-form";

async function LoginPageBody({ params }: Pick<PageProps<"/[locale]/login">, "params">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Suspense><LoginForm defaultCountry={packCountries()[0]?.iso2 ?? "GH"} /></Suspense>;
}

/** Params are read inside Suspense so the shared shell stays instant; generateStaticParams still prerenders the content. */
export default function LoginPage({ params }: PageProps<"/[locale]/login">) {
  return <Suspense fallback={<PageFallback />}><LoginPageBody params={params} /></Suspense>;
}
