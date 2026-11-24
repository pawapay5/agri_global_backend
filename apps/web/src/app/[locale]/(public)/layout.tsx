import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { SiteFooter, SiteHeader } from "@/components/shell/site-chrome";

type Params = LayoutProps<"/[locale]">["params"];

async function Header({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SiteHeader locale={locale} />;
}

async function Footer({ params }: { params: Params }) {
  const { locale } = await params;
  return <SiteFooter locale={locale} />;
}

/** Header and footer read the locale inside Suspense; each page sets its own request locale. */
export default function PublicLayout({ children, params }: LayoutProps<"/[locale]">) {
  return (
    <>
      <Suspense fallback={<div className="h-16 border-b border-border" />}><Header params={params} /></Suspense>
      <main id="main" className="flex-1">{children}</main>
      <Suspense fallback={<div className="h-40 border-t border-border" />}><Footer params={params} /></Suspense>
    </>
  );
}
