import { defineRouting } from "next-intl/routing";

export const locales = ["en", "fr", "tw", "ee", "gaa", "ha", "sw", "pt", "ar"] as const;
export type Locale = (typeof locales)[number];
export const rtlLocales: readonly Locale[] = ["ar"];

/** Locales with a complete, reviewed message catalogue. Others fall back to English per key. */
export const translatedLocales: readonly Locale[] = ["en", "fr"];

export const routing = defineRouting({
  locales,
  defaultLocale: "en",
  localePrefix: "always",
  localeCookie: { name: "ap_locale", maxAge: 60 * 60 * 24 * 365 },
});

export const dir = (l: string) => (rtlLocales.includes(l as Locale) ? "rtl" : "ltr");
