import { describe, expect, it } from "vitest";
import { convertForDisplay, pctChange, perKg, toUsd } from "./money.math";

describe("money math", () => {
  it("normalises a 100 kg bag price to per-kg", () => {
    expect(perKg("1250", "100").toString()).toBe("12.5");
  });

  it("rejects non-positive unit factors", () => {
    expect(() => perKg("10", "0")).toThrow(RangeError);
  });

  it("uses the local amount directly when display currency is local", () => {
    const v = convertForDisplay({ perKgLocal: "12.5", perKgUsd: "0.8", localCurrency: "GHS", targetCurrency: "GHS", targetKgPerUnit: "50" });
    expect(v.toString()).toBe("625");
  });

  it("converts via USD for third currencies", () => {
    // 0.8 USD/kg × 0.92 EUR/USD × 1 kg
    const v = convertForDisplay({ perKgLocal: "12.5", perKgUsd: "0.8", localCurrency: "GHS", targetCurrency: "EUR", usdToTarget: "0.92", targetKgPerUnit: "1" });
    expect(v.toString()).toBe("0.736");
  });

  it("throws if a third-currency rate is missing", () => {
    expect(() => convertForDisplay({ perKgLocal: "1", perKgUsd: "1", localCurrency: "GHS", targetCurrency: "NGN", targetKgPerUnit: "1" })).toThrow();
  });

  it("computes USD per kg and percentage change", () => {
    expect(toUsd("15", "0.0645").toString()).toBe("0.9675");
    expect(pctChange("110", "100")).toBe(10);
    expect(pctChange("90", "0")).toBeNull();
    expect(pctChange(null, "1")).toBeNull();
  });
});
