/** Plan entitlements. Free is the floor; an active personal or organisation subscription raises it. */

export type PlanCode = "free" | "premium" | "organisation";
export interface Entitlements {
  forecast_horizons: number[];
  alerts_max: number;
  alert_channels: string[];
  reports_per_month: number;
  report_formats: string[];
  history_range: string[];          // allowed price-history ranges
  export_insights: boolean;
  recommendations: boolean;
  api_daily_quota: number;          // public data API calls/day (0 = no access)
  api_keys_max: number;
  seats: number;
}

export const DEFAULT_ENTITLEMENTS: Record<PlanCode, Entitlements> = {
  free: { forecast_horizons: [1], alerts_max: 3, alert_channels: ["push", "in_app"], reports_per_month: 2, report_formats: ["csv"],
    history_range: ["1M", "3M"], export_insights: false, recommendations: true, api_daily_quota: 0, api_keys_max: 0, seats: 1 },
  premium: { forecast_horizons: [1, 3, 6], alerts_max: 50, alert_channels: ["push", "in_app", "email", "sms", "whatsapp"], reports_per_month: 30,
    report_formats: ["pdf", "xlsx", "csv"], history_range: ["1M", "3M", "6M", "1Y", "ALL"], export_insights: true, recommendations: true,
    api_daily_quota: 1000, api_keys_max: 2, seats: 1 },
  organisation: { forecast_horizons: [1, 3, 6], alerts_max: 200, alert_channels: ["push", "in_app", "email", "sms", "whatsapp"], reports_per_month: 500,
    report_formats: ["pdf", "xlsx", "csv"], history_range: ["1M", "3M", "6M", "1Y", "ALL"], export_insights: true, recommendations: true,
    api_daily_quota: 50000, api_keys_max: 20, seats: 25 },
};

export interface SubscriptionLike { planCode: PlanCode; status: string; currentPeriodEnd: Date | null }

const RANK: Record<PlanCode, number> = { free: 0, premium: 1, organisation: 2 };
export const PAST_DUE_GRACE_DAYS = 3;

export function isLive(s: SubscriptionLike, now = new Date()): boolean {
  if (s.status === "active" || s.status === "trialing") return !s.currentPeriodEnd || s.currentPeriodEnd > now;
  // Payment failed: keep access for a short grace period while the store/PSP retries.
  if (s.status === "past_due") return !!s.currentPeriodEnd && now.getTime() - s.currentPeriodEnd.getTime() < PAST_DUE_GRACE_DAYS * 86_400_000;
  // Cancelled at period end still runs until the period ends.
  if (s.status === "cancelled") return !!s.currentPeriodEnd && s.currentPeriodEnd > now;
  return false;
}

export function effectivePlan(subs: SubscriptionLike[], now = new Date()): PlanCode {
  return subs.filter((s) => isLive(s, now)).reduce<PlanCode>((best, s) => (RANK[s.planCode] > RANK[best] ? s.planCode : best), "free");
}

/** Plan rows may override defaults key-by-key (from the plans table). */
export function entitlementsFor(plan: PlanCode, overrides?: Partial<Entitlements>): Entitlements {
  return { ...DEFAULT_ENTITLEMENTS[plan], ...(overrides ?? {}) };
}

export type BillingEventType = "activated" | "renewed" | "cancelled" | "expired" | "payment_failed" | "ignored";

/** Normalises RevenueCat event types onto our subscription status changes. */
export function revenueCatStatus(type: string): { status: string; event: BillingEventType } {
  switch (type) {
    case "INITIAL_PURCHASE": case "UNCANCELLATION": case "PRODUCT_CHANGE": return { status: "active", event: "activated" };
    case "RENEWAL": return { status: "active", event: "renewed" };
    case "CANCELLATION": return { status: "cancelled", event: "cancelled" };
    case "BILLING_ISSUE": return { status: "past_due", event: "payment_failed" };
    case "EXPIRATION": return { status: "expired", event: "expired" };
    default: return { status: "", event: "ignored" };
  }
}
