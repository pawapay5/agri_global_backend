import { Suspense } from "react";
import { PageFallback } from "@/components/ui/page-fallback";
import { setRequestLocale } from "next-intl/server";
import { packCountries } from "@/lib/countries";
import { pick } from "@/lib/utils";
import { SignupForm } from "./signup-form";

async function SignupPageBody({ params }: Pick<PageProps<"/[locale]/signup">, "params">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const countries = packCountries().map((c) => ({ iso2: c.iso2, name: pick(c.name, locale) }));
  return <SignupForm countries={countries} />;
}

/** Params are read inside Suspense so the shared shell stays instant; generateStaticParams still prerenders the content. */
export default function SignupPage({ params }: PageProps<"/[locale]/signup">) {
  return <Suspense fallback={<PageFallback />}><SignupPageBody params={params} /></Suspense>;
}
