"use client";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Root providers, on every page (public included): translations and theme only. Kept minimal because public
 * pages carry a JS budget; data fetching, URL state and the feedback dialog live in app-providers.tsx, a
 * separate module, since Next ships a client module whole (one file = one bundle entry).
 * The intl provider is rendered here with everything passed in, so next-intl's server wrapper never falls
 * back to reading request headers, which would block prerendering.
 */
export function Providers({ children, locale, messages }: { children: ReactNode; locale: string; messages: AbstractIntlMessages }) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        {children}
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}
