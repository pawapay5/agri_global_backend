import { describe, expect, it } from "vitest";
import { describeRule } from "./alerts";
import { normalisePhone } from "./notification-settings";
import { notificationHref } from "./notifications";

const t = (k: string, v?: Record<string, string | number>) => `${k}|${Object.values(v ?? {}).join("|")}`;
const ID = "497f6eca-6276-4993-bfeb-53cbbbba6f08", M = "a29f01e1-8a8d-451e-b685-f8b0b4ec4767";

describe("describeRule", () => {
  it("states a price threshold with currency and unit", () => {
    expect(describeRule({ condition: "below", threshold: "12", thresholdCurrency: "GHS", thresholdUnit: "kg" }, "en", t)).toMatch(/^cond_below\|GHS\s?12\.00\/kg$/);
  });
  it("states a percentage move unsigned with its window", () => {
    expect(describeRule({ condition: "pct_change", threshold: "-10", pctWindowDays: 14 }, "en", t)).toBe("cond_pct_change|±10.0%|14");
  });
});

describe("notificationHref", () => {
  it("routes by payload, most specific first", () => {
    expect(notificationHref({ category: "price_alert", data: { alertId: ID } })).toBe("/app/alerts?tab=history");
    expect(notificationHref({ category: "market_update", data: { commodityId: ID, marketId: M } })).toBe(`/app/forecast/${ID}?market=${M}`);
    expect(notificationHref({ category: "weekly_insight", data: { commodityId: ID } })).toBe(`/app/commodities/${ID}`);
  });
  it("ignores payloads that aren't ids (no open redirects)", () => {
    expect(notificationHref({ category: "system", data: { commodityId: "//evil.example" } })).toBeNull();
    expect(notificationHref({ category: "system", data: {} })).toBeNull();
  });
});

describe("normalisePhone", () => {
  it("accepts international numbers with spacing", () => expect(normalisePhone("+233 24 123-4567")).toBe("+233241234567"));
  it("rejects local or malformed numbers", () => {
    expect(normalisePhone("0241234567")).toBeNull();
    expect(normalisePhone("+12")).toBeNull();
  });
});
