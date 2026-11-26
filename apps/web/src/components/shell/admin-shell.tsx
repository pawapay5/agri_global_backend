"use client";
import { ArrowLeft, BadgeCheck, Banknote, BarChart3, BookOpenCheck, ClipboardCheck, FileUp, Gavel, Globe2, LayoutDashboard, Megaphone, Menu, Scale, ScrollText, ShieldAlert, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

type Role = "admin" | "org_admin" | "enumerator" | "agronomist";
const ALL: Role[] = ["admin", "org_admin", "enumerator", "agronomist"];

/**
 * Sections per staff role. This only tidies the menu: the API authorises (and audits) every request, and
 * admin/layout.tsx has already checked server-side that the caller is staff.
 */
export const ADMIN_SECTIONS = [
  { group: "g_data", items: [
    { href: "/admin", key: "overview", icon: LayoutDashboard, roles: ALL, exact: true },
    { href: "/admin/prices/review", key: "review", icon: ClipboardCheck, roles: ["admin", "org_admin", "enumerator"] as Role[] },
    { href: "/admin/prices/import", key: "import", icon: FileUp, roles: ["admin", "org_admin", "enumerator"] as Role[] },
    { href: "/admin/catalogue", key: "catalogue", icon: BookOpenCheck, roles: ["admin", "org_admin", "agronomist"] as Role[] },
    { href: "/admin/countries", key: "countries", icon: Globe2, roles: ["admin", "org_admin"] as Role[] },
  ] },
  { group: "g_people", items: [
    { href: "/admin/users", key: "users", icon: Users, roles: ["admin", "org_admin"] as Role[] },
    { href: "/admin/kyc", key: "sellerApprovals", icon: BadgeCheck, roles: ["admin", "org_admin"] as Role[] },
    { href: "/admin/moderation", key: "moderation", icon: ShieldAlert, roles: ["admin"] as Role[] },
    { href: "/admin/disputes", key: "disputes", icon: Gavel, roles: ["admin"] as Role[] },
  ] },
  { group: "g_money", items: [
    { href: "/admin/payouts", key: "payouts", icon: Banknote, roles: ["admin"] as Role[] },
    { href: "/admin/reconciliation", key: "reconciliation", icon: Scale, roles: ["admin"] as Role[] },
  ] },
  { group: "g_platform", items: [
    { href: "/admin/broadcasts", key: "broadcasts", icon: Megaphone, roles: ["admin", "org_admin"] as Role[] },
    { href: "/admin/models", key: "models", icon: BarChart3, roles: ["admin", "agronomist"] as Role[] },
    { href: "/admin/audit", key: "audit", icon: ScrollText, roles: ["admin"] as Role[] },
  ] },
] as const;

/** Sections a role sees (exported for tests). */
export function sectionsFor(role: string) {
  return ADMIN_SECTIONS.map((g) => ({ ...g, items: g.items.filter((i) => (i.roles as readonly string[]).includes(role)) })).filter((g) => g.items.length);
}

function Nav({ role, onNavigate }: { role: string; onNavigate?: () => void }) {
  const t = useTranslations("adm");
  const path = usePathname();
  return (
    <nav aria-label={t("nav")} className="space-y-5">
      {sectionsFor(role).map((g) => (
        <div key={g.group}>
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-fg">{t(g.group)}</p>
          <ul className="space-y-0.5">
            {g.items.map((i) => {
              const on = "exact" in i && i.exact ? path === i.href : path === i.href || path.startsWith(`${i.href}/`);
              return (
                <li key={i.href}><Link href={i.href} onClick={onNavigate} aria-current={on ? "page" : undefined}
                  className={cn("flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm", on ? "bg-brand text-brand-fg" : "hover:bg-muted")}>
                  <i.icon aria-hidden className="size-4" />{t(i.key)}
                </Link></li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AdminShell({ role, host, children }: { role: string; host: string; children: ReactNode }) {
  const t = useTranslations("adm");
  return (
    <div className="page-backdrop flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-4 overflow-y-auto border-e border-border bg-card/80 p-3 backdrop-blur-xl lg:flex">
        <div className="flex items-center justify-between gap-2 px-3 pt-2"><Link href="/admin" className="font-semibold tracking-tight">{t("console")}</Link><ThemeToggle /></div>
        <Nav role={role} />
        <div className="mt-auto space-y-1 border-t border-border px-3 pt-3 text-xs text-muted-fg">
          <p>{t("signedInAs", { role })}</p>
          <p className="truncate">{t("env", { host })}</p>
          <Link href="/app" className="inline-flex items-center gap-1 font-semibold text-brand hover:underline"><ArrowLeft aria-hidden className="size-3.5 rtl:rotate-180" />{t("backToApp")}</Link>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border/70 bg-background/80 px-4 backdrop-blur-xl lg:hidden">
          <Link href="/admin" className="font-semibold">{t("console")}</Link>
          <span className="flex items-center gap-0.5"><ThemeToggle />
          <details className="relative">
            <summary className="list-none rounded-lg p-2 hover:bg-muted [&::-webkit-details-marker]:hidden" aria-label={t("nav")}><Menu className="size-5" /></summary>
            <div className="absolute end-0 z-50 mt-1 max-h-[80vh] w-64 overflow-y-auto rounded-xl border border-border bg-card p-3 shadow-elev-2"><Nav role={role} /></div>
          </details></span>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
