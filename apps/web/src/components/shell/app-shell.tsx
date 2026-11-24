"use client";
import { Bell, ChartSpline, House, LogOut, Store, Wheat } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Suspense, type ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { Link, usePathname } from "@/i18n/navigation";
import { useMe } from "@/lib/api/queries";
import { bff } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/app", key: "home", icon: House, exact: true },
  { href: "/app/commodities", key: "commodities", icon: Wheat, exact: false },
  { href: "/app/markets", key: "markets", icon: Store, exact: false },
  { href: "/app/forecast", key: "forecast", icon: ChartSpline, exact: false },
  { href: "/app/alerts", key: "alerts", icon: Bell, exact: false },
] as const;

type Variant = "side" | "bottom";
const styles: Record<Variant, { base: string; on: string; off: string }> = {
  side: { base: "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium", on: "bg-brand text-brand-fg", off: "hover:bg-muted" },
  bottom: { base: "flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", on: "text-brand", off: "text-muted-fg" },
};

function Links({ variant, path }: { variant: Variant; path: string | null }) {
  const t = useTranslations("nav");
  const s = styles[variant];
  return NAV.map((n) => {
    const on = path != null && (n.exact ? path === n.href : path === n.href || path.startsWith(`${n.href}/`));
    return (
      <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined} className={cn(s.base, on ? s.on : s.off)}>
        <n.icon aria-hidden className="size-5" />{t(n.key)}
      </Link>
    );
  });
}

/** Reads the pathname, so it streams in; the fallback renders the same links without the active state. */
function ActiveLinks({ variant }: { variant: Variant }) {
  return <Links variant={variant} path={usePathname()} />;
}

function NavLinks({ variant }: { variant: Variant }) {
  return <Suspense fallback={<Links variant={variant} path={null} />}><ActiveLinks variant={variant} /></Suspense>;
}

/** Left sidebar on desktop, bottom tab bar on mobile (mirrors the app's tabs). */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations("nav");
  const locale = useLocale();
  const me = useMe();
  const signOut = async () => { await bff("logout"); window.location.assign(`/${locale}/login`); };

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-e border-border bg-card p-4 lg:flex">
        <Link href="/app" className="mb-8"><Logo suffix={me.data?.country} /></Link>
        <nav aria-label="App" className="flex flex-1 flex-col gap-1"><NavLinks variant="side" /></nav>
        <div className="border-t border-border pt-4">
          <p className="truncate text-sm font-semibold">{me.data?.fullName ?? me.data?.email ?? me.data?.phone ?? "…"}</p>
          <p className="text-xs capitalize text-muted-fg">{me.data?.role}</p>
          <button onClick={signOut} className="mt-3 flex items-center gap-2 text-sm text-down hover:underline"><LogOut aria-hidden className="size-4" />{t("signOut")}</button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-20 lg:pb-0">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur lg:hidden">
          <Link href="/app"><Logo suffix={me.data?.country} /></Link>
          <button onClick={signOut} aria-label={t("signOut")} className="rounded-lg p-2 hover:bg-muted"><LogOut className="size-5" /></button>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 p-4 lg:p-8">{children}</main>
      </div>

      <nav aria-label="App" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-card lg:hidden"><NavLinks variant="bottom" /></nav>
    </div>
  );
}
