import { CloudRain, CloudSun, Sun } from "lucide-react";
import { describe, expect, it } from "vitest";
import { exportSeries } from "./insights-export";
import { weatherIcon } from "./insights-weather";

describe("weatherIcon", () => {
  it("maps WMO codes to icons", () => {
    expect(weatherIcon(0)).toBe(Sun);
    expect(weatherIcon(63)).toBe(CloudRain);
    expect(weatherIcon(81)).toBe(CloudRain);
    expect(weatherIcon(null)).toBe(CloudSun);
  });
});

describe("exportSeries", () => {
  const trend = [
    { period: "2026-02", destination: "EU", priceUsdPerKg: "2.1", display: "25.2" },
    { period: "2026-01", destination: "EU", priceUsdPerKg: "2.0", display: "24.0" },
    { period: "2026-01", destination: "GB", priceUsdPerKg: "2.4", display: "28.8" },
  ];
  it("filters to the destination, sorts by period and uses local currency when every point has it", () => {
    expect(exportSeries({ trend, currency: "GHS" }, "EU")).toEqual({ currency: "GHS", points: [{ t: "2026-01-01", avg: "24.0" }, { t: "2026-02-01", avg: "25.2" }] });
  });
  it("falls back to USD when any point lacks a local figure", () => {
    const s = exportSeries({ trend: [...trend, { period: "2026-03", destination: "EU", priceUsdPerKg: "2.2" }], currency: "GHS" }, "EU");
    expect(s.currency).toBe("USD");
    expect(s.points.map((p) => p.avg)).toEqual(["2.0", "2.1", "2.2"]);
  });
});
