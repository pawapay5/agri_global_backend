import { describe, expect, it } from "vitest";
import { bandPath, linear, linePath, nearestIndex, niceTicks, timeTicks } from "./chart-scale";

describe("linear", () => {
  it("maps and inverts", () => {
    const s = linear([0, 10], [100, 0]);
    expect(s(5)).toBe(50);
    expect(s.invert(25)).toBe(7.5);
  });
  it("survives a zero-width domain", () => expect(Number.isFinite(linear([3, 3], [0, 100])(3))).toBe(true));
});

describe("niceTicks", () => {
  it("gives round steps that cover the data", () => {
    const { ticks, domain } = niceTicks(11.3, 18.9, 5);
    expect(ticks).toEqual([10, 12, 14, 16, 18, 20]);
    expect(domain).toEqual([10, 20]);
  });
  it("handles a flat series", () => {
    const { ticks } = niceTicks(12, 12);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks[0]).toBeLessThan(12);
  });
  it("avoids float noise", () => expect(niceTicks(0.1, 0.7, 4).ticks.every((t) => String(t).length < 6)).toBe(true));
  it("returns nothing for non-finite input", () => expect(niceTicks(Number.NaN, 1).ticks).toEqual([]));
});

describe("timeTicks", () => {
  const d = (s: string) => Date.parse(s);
  it("snaps to midnights inside the range", () => {
    const ticks = timeTicks(d("2026-06-01T15:00:00Z"), d("2026-11-24T00:00:00Z"), 5);
    expect(ticks.length).toBeLessThanOrEqual(5);
    expect(ticks.every((t) => t % 86_400_000 === 0)).toBe(true);
    expect(ticks[0]!).toBeGreaterThanOrEqual(d("2026-06-01T15:00:00Z"));
  });
});

describe("paths", () => {
  it("breaks the line at gaps instead of bridging", () => {
    expect(linePath([{ x: 0, y: 1 }, { x: 1, y: null }, { x: 2, y: 3 }])).toBe("M0.0,1.0M2.0,3.0");
  });
  it("closes the band", () => {
    expect(bandPath([{ x: 0, lo: 5, hi: 1 }, { x: 10, lo: 6, hi: 2 }])).toBe("M0.0,1.0L10.0,2.0L10.0,6.0L0.0,5.0Z");
    expect(bandPath([{ x: 0, lo: 1, hi: 2 }])).toBe("");
  });
  it("finds the nearest point", () => {
    expect(nearestIndex([0, 10, 20, 30], 14)).toBe(1);
    expect(nearestIndex([0, 10, 20, 30], 16)).toBe(2);
    expect(nearestIndex([], 5)).toBe(-1);
  });
});
