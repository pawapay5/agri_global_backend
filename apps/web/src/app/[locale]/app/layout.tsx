import type { Metadata } from "next";
import { connection } from "next/server";
import { AppProviders } from "@/components/app-providers";

export const metadata: Metadata = { robots: { index: false, follow: false } };
// Rendered per request so Next.js can stamp the strict CSP nonce (set in proxy.ts) on its scripts.
export const instant = false;

/**
 * Signed-in area. proxy.ts redirects anonymous visitors; every data call still goes through the BFF,
 * where the backend verifies the token. Chrome lives in (shell)/layout.tsx so full-screen flows
 * (onboarding) can sit under /app without the sidebar.
 */
export default async function AppLayout({ children }: LayoutProps<"/[locale]/app">) {
  await connection();
  return <AppProviders>{children}</AppProviders>;
}
