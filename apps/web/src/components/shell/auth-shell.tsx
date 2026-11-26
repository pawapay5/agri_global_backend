"use client";
import Image from "next/image";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { Link, usePathname } from "@/i18n/navigation";
import loginBg from "../../../public/images/login_background.jpeg";
import registerBg from "../../../public/images/register_background.jpeg";
import { ThemeToggle } from "./theme-toggle";

/**
 * Split layout: brand panel on the left, form column on the right. The panel shows a farm photo (register image on
 * sign-up, login image elsewhere) under the brand green as a translucent overlay, so the panel still reads as the
 * green brand panel. The photo is decorative (alt=""). A client component so links take the locale from the intl
 * provider (keeps the auth layout free of URL data and fully prerenderable).
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const bg = path.startsWith("/signup") ? registerBg : loginBg;
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="relative isolate hidden flex-col justify-between overflow-hidden bg-hero p-12 text-hero-fg lg:flex">
        <Image src={bg} alt="" fill priority placeholder="blur" sizes="50vw" className="-z-20 object-cover" />
        <div aria-hidden className="absolute inset-0 -z-10 bg-hero/80" />
        <Link href="/" className="w-fit rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-white"><Logo className="text-white" /></Link>
        <p className="max-w-md text-3xl font-bold leading-snug">Smarter markets. Stronger farmers. A food-secure future.</p>
        <p className="text-white/80">Data. Forecasts. Better Decisions.</p>
      </aside>
      <main id="main" className="relative flex items-center justify-center p-6">
        <div className="absolute end-4 top-4"><ThemeToggle /></div>
        <div className="w-full max-w-sm space-y-6">
          <Link href="/" className="lg:hidden"><Logo /></Link>
          {children}
        </div>
      </main>
    </div>
  );
}
