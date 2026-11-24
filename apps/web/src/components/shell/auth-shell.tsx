"use client";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { Link } from "@/i18n/navigation";

/**
 * Split brand panel + form column. A client component so its links take the locale from the intl
 * provider instead of the request (keeps the auth layout free of URL data and fully prerenderable).
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-brand p-12 text-white lg:flex">
        <Link href="/"><Logo className="text-white" /></Link>
        <p className="max-w-md text-3xl font-bold leading-snug">Smarter markets. Stronger farmers. A food-secure future.</p>
        <p className="text-white/70">Data. Forecasts. Better Decisions.</p>
      </aside>
      <main id="main" className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <Link href="/" className="lg:hidden"><Logo /></Link>
          {children}
        </div>
      </main>
    </div>
  );
}
