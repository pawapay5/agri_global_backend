import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...v: ClassValue[]) => twMerge(clsx(v));

/** Money is a decimal string from the API; format without float drift for display only. */
export function formatMoney(amount: string | number | null | undefined, currency: string, locale = "en"): string {
  if (amount == null || amount === "") return "—";
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "code", minimumFractionDigits: 2, maximumFractionDigits: 2 })
      .format(n).replace(/ /g, " ");
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function formatPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function formatDate(iso: string | null | undefined, locale = "en", opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...opts }).format(new Date(iso));
}

export const pick = (t: Record<string, string> | null | undefined, locale: string) =>
  t ? t[locale] ?? t[locale.split("-")[0]!] ?? t.en ?? Object.values(t)[0] ?? "" : "";

export function greetingPeriod(hour: number): "morning" | "afternoon" | "evening" {
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}
