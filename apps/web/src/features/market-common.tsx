"use client";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/primitives";
import type { S } from "@/lib/api/browser";

/** Upload limit enforced in the browser before sending (the API re-checks and virus-scans). */
export const MAX_UPLOAD_MB = 8;
export const tooBig = (f: File) => f.size > MAX_UPLOAD_MB * 1024 * 1024;
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

/** Only http(s) URLs from the API become links or images (never javascript:/data:). */
export const isHttp = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u);

/** Payment pages a buyer may be sent to for card payments (exported for tests). */
const PAY_DOMAINS = ["paystack.com", "flutterwave.com", "hubtel.com"];
export function isTrustedPaymentUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && PAY_DOMAINS.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
  } catch { return false; }
}

/** E.164: "+" then 7–15 digits, spaces and dashes ignored (exported for tests). */
export function normaliseMsisdn(v: string): string | null {
  const s = v.replace(/[\s\-().]/g, "");
  return /^\+[1-9]\d{6,14}$/.test(s) ? s : null;
}

/** Short, human order reference from its id (the API has no separate number). */
export const orderRef = (id: string) => `#${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

const ORDER_TONE: Record<S["OrderStatus"], "neutral" | "brand" | "up" | "down" | "forecast"> = {
  pending_payment: "forecast", paid_in_escrow: "brand", accepted: "brand", in_transit: "brand", delivered: "brand", completed: "up", cancelled: "neutral", disputed: "down", refunded: "neutral",
};
export function OrderStatusBadge({ status }: { status: S["OrderStatus"] }) {
  const t = useTranslations("mp");
  return <Badge tone={ORDER_TONE[status] ?? "neutral"}>{t(`status_${status}`)}</Badge>;
}
