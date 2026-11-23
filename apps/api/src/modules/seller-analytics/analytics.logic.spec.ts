import { describe, expect, it } from "vitest";
import { activityScore, demandIndex, periodChangePct, supplyShares } from "./analytics.logic";

describe("seller analytics logic", () => {
  it("computes period-over-period change", () => {
    expect(periodChangePct(150, 100)).toBe(50);
    expect(periodChangePct(0, 0)).toBe(0);
    expect(periodChangePct(5, 0)).toBeNull();
  });
  it("weights activity", () => expect(activityScore({ views: 10, favourites: 1, offers: 1, orders: 1 })).toBe(41));
  it("demand index is ~100 in steady state and rises with activity and price momentum", () => {
    const flat = Array(16).fill(100), prices = Array(16).fill(10);
    const idx = demandIndex(flat, prices);
    expect(idx.slice(0, 6).every((x) => x === null)).toBe(true);
    expect(idx[15]).toBe(100);
    const spike = [...flat.slice(0, 15), 200];
    expect(demandIndex(spike, prices)[15]).toBeCloseTo(100 * Math.pow(2, 0.7), 0);
    const rising = [...prices.slice(0, 12), 12, 12, 12, 12];
    expect(demandIndex(flat, rising)[15]!).toBeGreaterThan(100);
  });
  it("computes supply shares", () => {
    const s = supplyShares([{ regionId: "a", quantityKg: 300 }, { regionId: "b", quantityKg: 100 }]);
    expect(s[0]).toEqual({ regionId: "a", quantityKg: 300, sharePct: 75 });
  });
});
