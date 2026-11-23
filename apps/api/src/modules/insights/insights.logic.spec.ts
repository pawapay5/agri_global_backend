import { describe, expect, it } from "vitest";
import { evalCondition, recommend, seasonalProfile, weatherMetrics } from "./insights.logic";

describe("seasonalProfile", () => {
  // Lean-season peak in June/July, post-harvest low in Oct/Nov, with inflation across years.
  const shape = [1.0, 1.02, 1.05, 1.1, 1.15, 1.25, 1.25, 1.1, 0.95, 0.85, 0.85, 0.95];
  const pts = [2024, 2025, 2026].flatMap((y, yi) => shape.map((s, m) => ({ year: y, month: m + 1, avg: 10 * s * (1 + 0.2 * yi) })));
  const p = seasonalProfile(pts, 3, new Date("2026-12-01"));

  it("returns three years of 12 months", () => {
    expect(p.years.map((y) => y.year)).toEqual([2024, 2025, 2026]);
    expect(p.years.every((y) => y.months.length === 12)).toBe(true);
  });
  it("finds peak and low months independent of inflation", () => {
    expect(p.peakMonths).toEqual([6, 7]);
    expect(p.lowMonths).toEqual([10, 11]);
  });
  it("computes the average month-on-month change", () => {
    expect(p.avgMonthlyChangePct[5]).toBeCloseTo(((1.25 - 1.15) / 1.15) * 100, 1); // June vs May
    expect(p.avgMonthlyChangePct[0]).not.toBeNull(); // Jan vs previous Dec (2025, 2026)
  });
  it("does not invent peaks from sparse data", () => {
    expect(seasonalProfile([{ year: 2026, month: 1, avg: 5 }], 3, new Date("2026-06-01")).peakMonths).toEqual([]);
  });
});

describe("recommend", () => {
  const base = { perishability: "low" as const, peakMonths: [6], alternatives: [] };
  it("says sell now when a fall is forecast with usable confidence", () => {
    const r = recommend({ ...base, horizons: [{ months: 1, changePct: -9, confidence: "medium" }] });
    expect(r[0]!.kind).toBe("sell_now");
  });
  it("ignores low-confidence forecasts", () => {
    expect(recommend({ ...base, horizons: [{ months: 1, changePct: -20, confidence: "low" }] })).toEqual([]);
  });
  it("says hold for storable crops when a rise is forecast", () => {
    const r = recommend({ ...base, horizons: [{ months: 3, changePct: 12, confidence: "high" }] });
    expect(r[0]).toMatchObject({ kind: "hold", basis: ["forecast", "seasonality"] });
  });
  it("does not advise holding perishable produce", () => {
    const r = recommend({ ...base, perishability: "high", horizons: [{ months: 3, changePct: 15, confidence: "high" }] });
    expect(r[0]!.kind).toBe("sell_now");
    expect(r[0]!.basis).toContain("perishability");
  });
  it("suggests the best alternative market above the margin threshold", () => {
    const r = recommend({ ...base, horizons: [], alternatives: [
      { marketId: "a", name: "A", distanceKm: 40, marginPct: 8 }, { marketId: "b", name: "B", distanceKm: 80, marginPct: 22 }, { marketId: "c", name: "C", distanceKm: 300, marginPct: 15 },
    ] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "alternative_market", marketId: "b", confidence: "medium" });
  });
});

describe("weather rules", () => {
  const day = (precip: number, tMax = 30, tMin = 22, humidity = 80) => ({ date: "2026-06-01", tMin, tMax, precip, precipProb: null, humidity, windMax: 10, code: null });
  const m = weatherMetrics([day(0), day(0.5), day(30), day(25), day(10), day(0), day(0)]);
  it("computes rolling rain, dry run and warm-humid days", () => {
    expect(m.precip_max_3d).toBe(65);
    expect(m.dry_days_ahead).toBe(2);
    expect(m.warm_humid_days).toBe(7);
  });
  it("evaluates nested all/any conditions", () => {
    expect(evalCondition({ all: [{ metric: "precip_max_3d", op: ">=", value: 50 }, { any: [{ metric: "wind_max", op: ">", value: 100 }, { metric: "humidity_mean", op: ">=", value: 70 }] }] }, m)).toBe(true);
    expect(evalCondition({ metric: "unknown", op: ">", value: 0 }, m)).toBe(false);
  });
});
