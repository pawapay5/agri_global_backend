import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import en from "../messages/en.json";
import { routing } from "./routing";

type Messages = Record<string, unknown>;

/** Deep-merge a locale's messages over English so untranslated keys show English, never a raw key. */
function merge(base: Messages, over: Messages): Messages {
  const out: Messages = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && typeof base[k] === "object" ? merge(base[k] as Messages, v as Messages) : v;
  }
  return out;
}

export default getRequestConfig(async ({ locale: explicit, requestLocale }) => {
  // Prefer an explicitly passed locale (e.g. getMessages({ locale })) so callers never fall back to headers().
  const requested = explicit ?? (await requestLocale);
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  let messages: Messages = en;
  if (locale !== "en") {
    try {
      messages = merge(en, (await import(`../messages/${locale}.json`)).default);
    } catch {
      messages = en; // no catalogue yet for this locale
    }
  }
  return { locale, messages, timeZone: "UTC" };
});
