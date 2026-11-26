import { Menu } from "lucide-react";
import { cacheLife } from "next/cache";
import NextLink from "next/link";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

/**
 * Public header. Server component with no session read, so public pages stay fully static (the theme button is a
 * tiny client island). Navigation links don't prefetch: on a 4G phone, prefetching every linked route's code costs
 * more than it saves. The mobile menu is a <details> element: it works without JavaScript.
 */
export async function SiteHeader({ locale, country = "gh" }: { locale: string; country?: string }) {
  const t = await getTranslations({ locale, namespace: "nav" });
  const links = [
    { href: `/${country}/prices`, label: t("prices") },
    { href: `/${country}/markets`, label: t("markets") },
    { href: `/${country}/regions`, label: t("regions") },
    { href: `/${country}/marketplace`, label: t("marketplace") },
    { href: "/help", label: t("help") },
    { href: "/pricing", label: t("pricing") },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:rounded focus:bg-card focus:p-2">{t("skip")}</a>
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4">
        <Link href="/" prefetch={false} className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"><Logo suffix={country.toUpperCase()} /></Link>
        <nav className="hidden items-center gap-1 text-sm font-medium lg:flex" aria-label="Main">
          {links.map((l) => (
            <Link key={l.href} href={l.href} prefetch={false} className="relative rounded-lg px-3 py-2 text-foreground/80 transition-colors hover:bg-muted hover:text-foreground">{l.label}</Link>
          ))}
        </nav>
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <Link href="/login" prefetch={false} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hidden sm:inline-flex")}>{t("signIn")}</Link>
          <Link href="/signup" prefetch={false} className={cn(buttonVariants({ size: "sm" }), "px-4")}>{t("signUp")}</Link>
          <details className="group relative lg:hidden">
            <summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-lg hover:bg-muted [&::-webkit-details-marker]:hidden" aria-label={t("menu")}>
              <Menu aria-hidden className="size-5" />
            </summary>
            <nav aria-label="Main" className="absolute end-0 top-12 w-60 rounded-2xl border border-border bg-card p-2 shadow-elev-2">
              <ul>
                {links.map((l) => <li key={l.href}><Link href={l.href} prefetch={false} className="block rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted">{l.label}</Link></li>)}
                <li className="sm:hidden"><Link href="/login" prefetch={false} className="block rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted">{t("signIn")}</Link></li>
              </ul>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

export async function SiteFooter({ locale, country = "gh" }: { locale: string; country?: string }) {
  "use cache";
  cacheLife("days"); // the copyright year is read from the clock, so cache it rather than render per request
  const t = await getTranslations({ locale, namespace: "footer" });
  const tn = await getTranslations({ locale, namespace: "nav" });
  const tl = await getTranslations({ locale, namespace: "landing" });
  const groups: { title: string; links: { href: string; label: string }[] }[] = [
    { title: t("product"), links: [
      { href: `/${country}/prices`, label: tn("prices") }, { href: `/${country}/markets`, label: tn("markets") },
      { href: `/${country}/regions`, label: tn("regions") }, { href: `/${country}/marketplace`, label: tn("marketplace") }, { href: "/pricing", label: tn("pricing") },
    ] },
    { title: t("resources"), links: [
      { href: "/guides", label: tn("guides") }, { href: "/pests", label: t("pests") }, { href: "/help", label: tn("help") }, { href: "/methodology", label: t("methodology") },
    ] },
    { title: t("company"), links: [
      { href: "/about", label: t("about") }, { href: "/stories", label: t("stories") }, { href: "/contact", label: t("contact") }, { href: "/status", label: t("status") },
    ] },
    { title: t("legal"), links: [{ href: "/legal/privacy", label: t("privacy") }, { href: "/legal/terms", label: t("terms") }] },
  ];
  return (
    <footer className="relative mt-auto border-t border-border bg-card">
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-leaf/60 to-transparent" />
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 text-sm md:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-xs text-muted-fg">{tl("heroBody")}</p>
        </div>
        {groups.map((g) => (
          <nav key={g.title} aria-label={g.title}>
            <p className="mb-3 font-semibold">{g.title}</p>
            <ul className="space-y-2 text-muted-fg">
              {/* Plain next/link with the locale in the URL: next-intl's server Link reads request headers, which a
                  cached component can't. */}
              {g.links.map((l) => <li key={l.href}><NextLink href={`/${locale}${l.href}`} prefetch={false} className="transition-colors hover:text-brand dark:hover:text-leaf">{l.label}</NextLink></li>)}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-6 text-sm text-muted-fg">
          <Logo compact /><span>{t("rights", { year: new Date().getUTCFullYear() })}</span>
        </div>
      </div>
    </footer>
  );
}
