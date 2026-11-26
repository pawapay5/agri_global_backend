import { describe, expect, it } from "vitest";
import { biggestMonthlyMove } from "@/components/agri/seasonal-bars";
import type { S } from "@/lib/api/browser";
import { summarisePrices } from "./commodities";

const row = (amount: string, change: number | null, observedAt: string) =>
  ({ marketId: amount, marketName: { en: amount }, priceType: "wholesale", observedAt, changePctWoW: change,
    value: { display: { amount, currency: "GHS", unit: "kg" } } }) as unknown as S["MarketPrice"];

describe("summarisePrices", () => {
  it("returns null when no market reported (never a zero)", () => {
    expect(summarisePrices([])).toBeNull();
    expect(summarisePrices(undefined)).toBeNull();
  });
  it("takes the median, averages only known changes and keeps the newest report time", () => {
    const s = summarisePrices([row("10", 2, "2026-11-01T00:00:00Z"), row("30", null, "2026-11-20T00:00:00Z"), row("20", 4, "2026-11-10T00:00:00Z"), row("40", null, "2026-11-02T00:00:00Z")]);
    expect(s).toMatchObject({ median: 25, n: 4, change: 3, currency: "GHS", unit: "kg", latestAt: "2026-11-20T00:00:00Z" });
  });
});

describe("biggestMonthlyMove", () => {
  it("picks the largest absolute move and skips gaps", () => {
    expect(biggestMonthlyMove([null, 3, -8, 5, null, null, null, null, null, null, null, 1])).toEqual({ month: 3, pct: -8 });
    expect(biggestMonthlyMove(Array(12).fill(null))).toBeNull();
  });
});
