import "../src/app/globals.css";
import { withThemeByClassName } from "@storybook/addon-themes";
import type { Decorator, Preview } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { useEffect, useState, type ReactNode } from "react";
import { FeedbackProvider } from "../src/components/feedback/feedback";
import en from "../src/messages/en.json";
import fr from "../src/messages/fr.json";

type Msgs = Record<string, unknown>;
const merge = (base: Msgs, over: Msgs): Msgs => {
  const out: Msgs = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = v && typeof v === "object" && !Array.isArray(v) && typeof base[k] === "object" ? merge(base[k] as Msgs, v as Msgs) : v;
  return out;
};
// Same fallback as the app (src/i18n/request.ts): untranslated keys show English. Arabic has no catalogue
// yet, so the RTL stories exercise layout, mirroring and Arabic number formatting with English text.
const MESSAGES: Record<string, Msgs> = { en, fr: merge(en, fr), ar: en };
const RTL = new Set(["ar"]);

/** Locale + direction + app providers, mirroring src/app/[locale]/layout.tsx and components/providers.tsx. */
function AppProviders({ locale, children }: { locale: string; children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = RTL.has(locale) ? "rtl" : "ltr";
  }, [locale]);
  return (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale] as AbstractIntlMessages} timeZone="UTC">
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter>
          <FeedbackProvider>
            <div dir={RTL.has(locale) ? "rtl" : "ltr"} className="min-h-[200px] bg-surface p-6 font-sans text-foreground">
              {children}
            </div>
          </FeedbackProvider>
        </NuqsTestingAdapter>
      </QueryClientProvider>
    </NextIntlClientProvider>
  );
}

const withApp: Decorator = (Story, ctx) => (
  <AppProviders locale={(ctx.globals.locale as string) ?? "en"}><Story /></AppProviders>
);

const preview: Preview = {
  decorators: [withApp, withThemeByClassName({ themes: { light: "", dark: "dark" }, defaultTheme: "light" })],
  globalTypes: {
    locale: {
      description: "Locale (ar = right-to-left)",
      toolbar: { icon: "globe", dynamicTitle: true, items: [{ value: "en", title: "English" }, { value: "fr", title: "Français" }, { value: "ar", title: "العربية (RTL)" }] },
    },
  },
  initialGlobals: { locale: "en", theme: "light" },
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true },
    // axe runs on every story; violations fail the story in the test runner.
    a11y: { test: "error" },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
};

export default preview;
