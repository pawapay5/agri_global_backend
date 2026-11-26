import { describe, expect, it } from "vitest";
import { rankRegions } from "./markets-heatmap";
import { weekdayNames } from "./markets-map";
import { coarse } from "./markets-nearby";

describe("rankRegions", () => {
  const r = (code: string, avg: string | null) => ({ regionId: code, code, avg, observations: avg ? 3 : 0 });
  it("ignores regions without data and ranks the rest", () => {
    const out = rankRegions([r("a", "12"), r("b", null), r("c", "8"), r("d", "10")]);
    expect(out.rows.map((x) => x.code)).toEqual(["c", "d", "a"]);
    expect(out.cheapest[0]!.code).toBe("c");
    expect(out.priciest[0]!.code).toBe("a");
    expect(out.spreadPct).toBeCloseTo(50);
  });
  it("has no spread with one region or none", () => {
    expect(rankRegions([r("a", "12")]).spreadPct).toBeNull();
    expect(rankRegions([r("b", null)]).rows).toEqual([]);
  });
});

describe("coarse", () => {
  it("rounds to two decimals (about 1 km)", () => {
    expect(coarse(5.603716)).toBe(5.6);
    expect(coarse(-0.186964)).toBe(-0.19);
  });
});

describe("weekdayNames", () => {
  it("maps ISO weekdays (1 = Monday), drops invalid ones", () => {
    expect(weekdayNames([3, 1, 9, 0], "en")).toEqual(["Mon", "Wed"]);
    expect(weekdayNames(undefined, "en")).toEqual([]);
  });
});
