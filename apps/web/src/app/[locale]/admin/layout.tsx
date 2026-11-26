import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ACCESS_COOKIE, STAFF_ROLES, upstreamSignal } from "@/lib/auth/tokens";
import { AppProviders } from "@/components/app-providers";
import { AdminShell } from "@/components/shell/admin-shell";
import { env } from "@/lib/env";

export const metadata: Metadata = { robots: { index: false, follow: false } };
// Rendered per request: the strict CSP nonce needs it, and the role check below must never be cached.
export const instant = false;

/**
 * Server-side gate for the admin console. proxy.ts already applies the IP allow-list and a token-claims hint;
 * this asks the API who the caller is, so a forged or stale token can't render admin UI. Every admin action is
 * authorised again by the backend.
 */
export default async function AdminLayout({ children, params }: LayoutProps<"/[locale]/admin">) {
  await connection();
  const { locale } = await params;
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect(`/${locale}/login?next=/${locale}/admin`);
  const res = await fetch(`${env.apiUrl}/v1/me`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: upstreamSignal() }).catch(() => null);
  if (!res) throw new Error("Admin check failed: the API is unreachable"); // error page, not a misleading login redirect
  if (res.status === 401) redirect(`/${locale}/login?next=/${locale}/admin`);
  if (!res.ok) throw new Error(`Admin check failed: API returned ${res.status}`);
  const me = (await res.json()) as { role?: string };
  if (!STAFF_ROLES.includes(me.role as (typeof STAFF_ROLES)[number])) redirect(`/${locale}/app`);
  return <AppProviders><AdminShell role={me.role!} host={new URL(env.siteUrl).host}>{children}</AdminShell></AppProviders>;
}
