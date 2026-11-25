import { describe, expect, it } from "vitest";
import { absoluteTime, DASH, money, number, pct, pricePerUnit, relativeTime, unitLabel } from "./format";

describe("money", () => {
  it("formats the API's decimal strings in the given currency", () => {
    expect(money("12.5", "GHS", "en")).toBe("GHS 12.50");
    expect(money(1234.567, "KES", "en")).toBe("KES 1,234.57");
  });
  it("uses the locale's separators", () => {
    expect(money("1234.5", "EUR", "fr")).toMatch(/1\s?234,50/);
  });
  it("never renders a missing or bad value as a number", () => {
    for (const v of [null, undefined, "", "abc", Number.NaN]) expect(money(v as never, "GHS")).toBe(DASH);
    expect(money("1", "not-a-code")).toBe(DASH);
  });
  it("compacts large amounts", () => expect(money(4_200_000, "GHS", "en", { compact: true })).toBe("GHS 4.2M"));
});

describe("number / pct", () => {
  it("compacts and groups", () => {
    expect(number(1284, "en")).toBe("1,284");
    expect(number(12_900, "en", { compact: true })).toBe("12.9K");
  });
  it("signs percentages except zero", () => {
    expect(pct(4.2)).toBe("+4.2%");
    expect(pct(-3)).toBe("-3.0%");
    expect(pct(0)).toBe("0.0%");
    expect(pct(null)).toBe(DASH);
  });
  it("uses locale digits (Arabic)", () => expect(pct(4.2, "ar-EG")).not.toContain("4.2"));
});

describe("units", () => {
  it("labels catalogue unit codes", () => {
    expect(unitLabel("kg")).toBe("kg");
    expect(unitLabel("bag_50kg")).toBe("50 kg bag");
    expect(unitLabel("olonka")).toBe("olonka");
    expect(pricePerUnit("8", "GHS", "bag_50kg")).toBe("GHS 8.00/50 kg bag");
    expect(pricePerUnit(null, "GHS", "kg")).toBe(DASH);
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");
  it("picks the largest whole unit", () => {
    expect(relativeTime("2026-11-24T10:00:00Z", "en", now)).toBe("2 hours ago");
    expect(relativeTime("2026-11-23T12:00:00Z", "en", now)).toBe("yesterday");
    expect(relativeTime("2026-11-24T11:59:40Z", "en", now)).toBe("now");
  });
  it("localises", () => expect(relativeTime("2026-11-24T10:00:00Z", "fr", now)).toBe("il y a 2 heures"));
  it("handles bad input", () => expect(relativeTime("nope", "en", now)).toBe(DASH));
});

describe("absoluteTime", () => {
  it("formats with an explicit UTC label in every locale (no Intl option clash)", () => {
    for (const l of ["en", "fr", "ar", "sw", "pt"]) expect(() => absoluteTime("2026-11-24T10:05:00Z", l)).not.toThrow();
    expect(absoluteTime("2026-11-24T10:05:00Z", "en")).toMatch(/Nov 24, 2026.*10:05.*UTC/);
    expect(absoluteTime(null)).toBe(DASH);
  });
});
