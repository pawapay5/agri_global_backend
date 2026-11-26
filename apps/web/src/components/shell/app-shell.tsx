"use client";
import { CreditCard, Inbox, LayoutDashboard, LogOut, Menu, ShieldCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Suspense, type ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { Link, usePathname } from "@/i18n/navigation";
import { useSellerProfile } from "@/lib/api/market";
import { useMe, useUnreadCount } from "@/lib/api/queries";
import { bff } from "@/lib/auth/client";
import { cn } from "@/lib/utils";
import { isStaff, NAV, navFor, needsShopCheck, type NavContext } from "./app-nav";
import { ThemeToggle } from "./theme-toggle";

/** The signed-in person's menu context: role, organisation, and (only when the role doesn't decide) a shop. */
function useNavContext(): NavContext {
  const me = useMe();
  const role = me.data?.role;
  const shop = useSellerProfile(Boolean(me.data) && needsShopCheck(role));
  return { role, inOrg: Boolean(me.data?.organisationId), hasShop: Boolean(shop.data) };
}

/** Inbox link with the unread count in its accessible name (the badge alone is decorative). */
function InboxLink({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("nav");
  const td = useTranslations("dash");
  const n = useUnreadCount().data?.total ?? 0;
  const label = n ? `${t("notifications")}, ${td("unread", { n })}` : t("notifications");
  return (
    <Link href="/app/notifications" aria-label={compact ? label : undefined}
      className={compact ? "relative rounded-lg p-2 hover:bg-muted" : "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"}>
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
  const ctx = useNavContext();
  const extra = navFor(ctx).flatMap((g) => g.items).filter((n) => !n.bottom);
  const item = "flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-muted";
  return (
    <details className="relative">
      <summary className="list-none rounded-lg p-2 hover:bg-muted [&::-webkit-details-marker]:hidden" aria-label={t("menu")}><Menu className="size-5" /></summary>
      <div className="absolute end-0 z-50 mt-1 max-h-[75vh] w-60 overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-lg">
        {isStaff(ctx.role) ? <><Link href="/admin" className={cn(item, "font-semibold text-brand dark:text-leaf")}><LayoutDashboard aria-hidden className="size-4" />{t("adminConsole")}</Link><hr className="my-1 border-border" /></> : null}
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
  side: { base: "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors", on: "bg-brand text-brand-fg shadow-sm", off: "text-foreground/80 hover:bg-muted hover:text-foreground" },
  bottom: { base: "flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", on: "text-brand", off: "text-muted-fg" },
};

function Links({ variant, path }: { variant: Variant; path: string | null }) {
  const t = useTranslations("nav");
  const ctx = useNavContext();
  const s = styles[variant];
  const on = (n: (typeof NAV)[number]) => path != null && (n.exact ? path === n.href : path === n.href || path.startsWith(`${n.href}/`));
  const link = (n: (typeof NAV)[number]) => (
    <Link key={n.href} href={n.href} aria-current={on(n) ? "page" : undefined} className={cn(s.base, on(n) ? s.on : s.off)}>
      <n.icon aria-hidden className="size-5" />{t(n.key)}
    </Link>
  );
  if (variant === "bottom") return NAV.filter((n) => n.bottom).map(link);
  return (
    <>
      {isStaff(ctx.role) ? (
        <Link href="/admin" className="mb-3 flex items-center gap-3 rounded-xl border border-brand/30 bg-brand/5 px-3 py-2 text-sm font-semibold text-brand hover:bg-brand/10 dark:border-leaf/30 dark:text-leaf">
          <LayoutDashboard aria-hidden className="size-5" />{t("adminConsole")}
        </Link>
      ) : null}
      {navFor(ctx).map((g) => (
        <div key={g.group} className="mb-2">
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-fg">{t(`group_${g.group}`)}</p>
          <div className="flex flex-col gap-0.5">{g.items.map(link)}</div>
        </div>
      ))}
    </>
  );
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
    <div className="page-backdrop flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-e border-border bg-card/80 backdrop-blur-xl lg:flex">
        <Link href="/app" className="mx-4 mb-4 mt-5 w-fit rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"><Logo suffix={me.data?.country} /></Link>
        <nav aria-label="App" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3 [scrollbar-width:thin]"><NavLinks variant="side" /></nav>
        <div className="m-3 space-y-3 rounded-2xl border border-border bg-background/60 p-3">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-leaf to-brand text-sm font-semibold text-white">
              {(me.data?.fullName ?? me.data?.email ?? "?").trim().charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{me.data?.fullName ?? me.data?.email ?? me.data?.phone ?? "…"}</span>
              <span className="block text-xs capitalize text-muted-fg">{me.data?.role?.replace("_", " ")}</span>
            </span>
            <ThemeToggle />
          </div>
          <div className="grid gap-0.5 text-sm">
            <InboxLink />
            <Link href="/app/billing" className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted"><CreditCard aria-hidden className="size-4" />{t("billing")}</Link>
            <Link href="/app/settings/security" className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted"><ShieldCheck aria-hidden className="size-4" />{t("security")}</Link>
            <button onClick={signOut} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-start text-down hover:bg-down/10"><LogOut aria-hidden className="size-4" />{t("signOut")}</button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-20 lg:pb-0">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border/70 bg-background/80 px-4 backdrop-blur-xl lg:hidden">
          <Link href="/app"><Logo suffix={me.data?.country} /></Link>
          <span className="flex items-center gap-0.5"><ThemeToggle /><InboxLink compact /><MoreMenu onSignOut={signOut} /></span>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 p-4 lg:p-8">{children}</main>
      </div>

      <nav aria-label="App" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-card/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"><NavLinks variant="bottom" /></nav>
    </div>
  );
}
