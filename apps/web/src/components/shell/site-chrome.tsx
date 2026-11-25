import { cacheLife } from "next/cache";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** Public header. Server component; no session read, so public pages stay fully static. */
export async function SiteHeader({ locale, country = "gh" }: { locale: string; country?: string }) {
  const t = await getTranslations({ locale, namespace: "nav" });
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:rounded focus:bg-card focus:p-2">{t("skip")}</a>
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4">
        <Link href="/"><Logo suffix={country.toUpperCase()} /></Link>
        <nav className="hidden items-center gap-6 text-sm font-medium md:flex" aria-label="Main">
          <Link href={`/${country}/prices`} className="hover:text-brand">{t("prices")}</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" prefetch={false} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{t("signIn")}</Link>
          <Link href="/signup" prefetch={false} className={cn(buttonVariants({ size: "sm" }))}>{t("signUp")}</Link>
        </div>
      </div>
    </header>
  );
}

export async function SiteFooter({ locale }: { locale: string }) {
  "use cache";
  cacheLife("days"); // the copyright year is read from the clock, so cache it rather than render per request
  const t = await getTranslations({ locale, namespace: "footer" });
  return (
    <footer className="mt-auto border-t border-border bg-background">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-muted-fg md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3"><Logo compact /><span>{t("rights", { year: new Date().getUTCFullYear() })}</span></div>
      </div>
    </footer>
  );
}
