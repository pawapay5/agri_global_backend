"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { ThemeProvider } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { useState, type ReactNode } from "react";
import { FeedbackProvider } from "@/components/feedback/feedback";
import { ApiError } from "@/lib/api/browser";

/**
 * Client-side providers. The intl provider is rendered here (client module) with everything passed in, so
 * next-intl's server wrapper never falls back to reading request headers, which would block prerendering.
 */
export function Providers({ children, locale, messages }: { children: ReactNode; locale: string; messages: AbstractIntlMessages }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Don't hammer the API on client errors; retry network/5xx twice.
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      },
    },
  }));
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <QueryClientProvider client={client}>
          <NuqsAdapter><FeedbackProvider>{children}</FeedbackProvider></NuqsAdapter>
        </QueryClientProvider>
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}
