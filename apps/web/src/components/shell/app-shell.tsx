"use client";
import { Bell, ChartSpline, CreditCard, FileText, HandCoins, House, Inbox, Lightbulb, LogOut, Menu, MessageSquare, ShieldCheck, ShoppingBasket, Store, Table2, Wheat } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Suspense, type ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { Link, usePathname } from "@/i18n/navigation";
import { useMe, useUnreadCount } from "@/lib/api/queries";
import { bff } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/app", key: "home", icon: House, exact: true },
  { href: "/app/commodities", key: "commodities", icon: Wheat, exact: false },
  { href: "/app/markets", key: "markets", icon: Store, exact: false },
  { href: "/app/forecast", key: "forecast", icon: ChartSpline, exact: false },
  { href: "/app/alerts", key: "alerts", icon: Bell, exact: false },
  { href: "/app/messages", key: "messages", icon: MessageSquare, exact: false, sideOnly: true },
  { href: "/app/marketplace", key: "marketplace", icon: ShoppingBasket, exact: false, sideOnly: true },
  { href: "/app/sell", key: "sell", icon: HandCoins, exact: false, sideOnly: true },
  { href: "/app/insights", key: "insights", icon: Lightbulb, exact: false, sideOnly: true },
  { href: "/app/reports", key: "reports", icon: FileText, exact: false, sideOnly: true },
  { href: "/app/data", key: "data", icon: Table2, exact: false, sideOnly: true },
] as const;

/** Inbox link with the unread count in its accessible name (the badge alone is decorative). */
function InboxLink({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("nav");
  const td = useTranslations("dash");
  const n = useUnreadCount().data?.total ?? 0;
  const label = n ? `${t("notifications")}, ${td("unread", { n })}` : t("notifications");
  return (
    <Link href="/app/notifications" aria-label={compact ? label : undefined}
      className={compact ? "relative rounded-lg p-2 hover:bg-muted" : "mt-3 flex items-center gap-2 text-sm hover:underline"}>
      <span className="relative"><Inbox aria-hidden className={compact ? "size-5" : "size-4"} />
        {n ? <span aria-hidden className="absolute -end-1.5 -top-1.5 min-w-4 rounded-full bg-down px-1 text-center text-[10px] font-semibold leading-4 text-white">{n > 99 ? "99+" : n}</span> : null}
      </span>
      {compact ? null : <span>{t("notifications")}{n ? <span className="sr-only">, {td("unread", { n })}</span> : null}</span>}
    </Link>
  );
}

/**
 * Phone "More" menu: the sections that don't fit the five-item bottom bar, plus account links. A native
 * <details>, so it works before hydration and closes on navigation (the shell re-renders on route change).
 */
function MoreMenu({ onSignOut }: { onSignOut: () => void }) {
  const t = useTranslations("nav");
  const extra = NAV.filter((n) => "sideOnly" in n && n.sideOnly);
  const item = "flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-muted";
  return (
    <details className="relative">
      <summary className="list-none rounded-lg p-2 hover:bg-muted [&::-webkit-details-marker]:hidden" aria-label={t("menu")}><Menu className="size-5" /></summary>
      <div className="absolute end-0 z-50 mt-1 w-56 rounded-xl border border-border bg-card p-1.5 shadow-lg">
        {extra.map((n) => <Link key={n.href} href={n.href} className={item}><n.icon aria-hidden className="size-4" />{t(n.key)}</Link>)}
        <hr className="my-1 border-border" />
        <Link href="/app/billing" className={item}><CreditCard aria-hidden className="size-4" />{t("billing")}</Link>
        <Link href="/app/settings/security" className={item}><ShieldCheck aria-hidden className="size-4" />{t("security")}</Link>
        <button type="button" onClick={onSignOut} className={cn(item, "w-full text-down")}><LogOut aria-hidden className="size-4" />{t("signOut")}</button>
      </div>
    </details>
  );
}

type Variant = "side" | "bottom";
const styles: Record<Variant, { base: string; on: string; off: string }> = {
  side: { base: "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium", on: "bg-brand text-brand-fg", off: "hover:bg-muted" },
  bottom: { base: "flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", on: "text-brand", off: "text-muted-fg" },
};

function Links({ variant, path }: { variant: Variant; path: string | null }) {
  const t = useTranslations("nav");
  const s = styles[variant];
  return NAV.filter((n) => variant === "side" || !("sideOnly" in n && n.sideOnly)).map((n) => {
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
          <InboxLink />
          <Link href="/app/billing" className="mt-3 flex items-center gap-2 text-sm hover:underline"><CreditCard aria-hidden className="size-4" />{t("billing")}</Link>
          <Link href="/app/settings/security" className="mt-3 flex items-center gap-2 text-sm hover:underline"><ShieldCheck aria-hidden className="size-4" />{t("security")}</Link>
          <button onClick={signOut} className="mt-2 flex items-center gap-2 text-sm text-down hover:underline"><LogOut aria-hidden className="size-4" />{t("signOut")}</button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-20 lg:pb-0">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur lg:hidden">
          <Link href="/app"><Logo suffix={me.data?.country} /></Link>
          <span className="flex items-center gap-1"><InboxLink compact /><MoreMenu onSignOut={signOut} /></span>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 p-4 lg:p-8">{children}</main>
      </div>

      <nav aria-label="App" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-card lg:hidden"><NavLinks variant="bottom" /></nav>
    </div>
  );
}
