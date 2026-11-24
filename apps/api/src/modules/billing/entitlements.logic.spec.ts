import { describe, expect, it } from "vitest";
import { effectivePlan, entitlementsFor, isLive, revenueCatStatus } from "./entitlements.logic";

const now = new Date("2026-06-10T00:00:00Z");
const d = (s: string) => new Date(s);

describe("entitlements", () => {
  it("defaults to free and picks the highest live plan", () => {
    expect(effectivePlan([], now)).toBe("free");
    expect(effectivePlan([{ planCode: "premium", status: "active", currentPeriodEnd: d("2026-07-01") },
      { planCode: "organisation", status: "active", currentPeriodEnd: d("2026-07-01") }], now)).toBe("organisation");
  });
  it("handles cancellation at period end, grace on past_due, expiry", () => {
    expect(isLive({ planCode: "premium", status: "cancelled", currentPeriodEnd: d("2026-06-20") }, now)).toBe(true);
    expect(isLive({ planCode: "premium", status: "cancelled", currentPeriodEnd: d("2026-06-01") }, now)).toBe(false);
    expect(isLive({ planCode: "premium", status: "past_due", currentPeriodEnd: d("2026-06-08") }, now)).toBe(true);
    expect(isLive({ planCode: "premium", status: "past_due", currentPeriodEnd: d("2026-06-01") }, now)).toBe(false);
    expect(isLive({ planCode: "premium", status: "active", currentPeriodEnd: d("2026-06-09") }, now)).toBe(false);
    expect(isLive({ planCode: "premium", status: "expired", currentPeriodEnd: null }, now)).toBe(false);
  });
  it("merges plan overrides over defaults", () => {
    expect(entitlementsFor("free").forecast_horizons).toEqual([1]);
    expect(entitlementsFor("premium", { alerts_max: 99 }).alerts_max).toBe(99);
  });
  it("maps RevenueCat events", () => {
    expect(revenueCatStatus("BILLING_ISSUE")).toEqual({ status: "past_due", event: "payment_failed" });
    expect(revenueCatStatus("TEST").event).toBe("ignored");
  });
});
