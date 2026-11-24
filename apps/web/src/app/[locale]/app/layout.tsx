import type { Metadata } from "next";
import { connection } from "next/server";
import { AppShell } from "@/components/shell/app-shell";

export const metadata: Metadata = { robots: { index: false, follow: false } };
// Rendered per request so Next.js can stamp the strict CSP nonce (set in proxy.ts) on its scripts.
export const instant = false;

/**
 * Signed-in area. proxy.ts redirects anonymous visitors; every data call still goes through the BFF,
 * where the backend verifies the token. Rendered per request (nonce CSP); user data loads client-side.
 */
export default async function AppLayout({ children }: LayoutProps<"/[locale]/app">) {
  await connection();
  return <AppShell>{children}</AppShell>;
}
