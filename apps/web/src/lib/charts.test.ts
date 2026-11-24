import { describe, expect, it } from "vitest";
import { buildForecastSeries, shapBars } from "./charts";
import { formatMoney, formatPct, greetingPeriod, pick } from "./utils";
import { claims, needsRefresh } from "./auth/tokens";

const jwt = (payload: object) => `e30.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

describe("buildForecastSeries", () => {
  const history = [{ t: "2026-03-01", avg: "10.00" }, { t: "2026-01-01", avg: "9.50" }, { t: "2026-02-01", avg: "bad" }];
  it("sorts history, drops invalid points and bridges into the forecast", () => {
    const rows = buildForecastSeries(history, [
      { targetDate: "2026-06-01", p10: "9", p50: "11", p90: "13" },
      { targetDate: "2026-04-01", p10: "9.5", p50: "10.5", p90: "11.5" },
      { targetDate: "2026-09-01", status: "insufficient_data", p10: null, p50: null, p90: null },
    ]);
    expect(rows.map((r) => new Date(r.t).toISOString().slice(0, 7))).toEqual(["2026-01", "2026-03", "2026-04", "2026-06"]);
    expect(rows[1]).toMatchObject({ actual: 10, p50: 10, band: [10, 10] });
    expect(rows[3]).toMatchObject({ p50: 11, band: [9, 13] });
  });
  it("returns history only when no horizon is available", () => {
    expect(buildForecastSeries(history, [])).toHaveLength(2);
  });
});

describe("shapBars", () => {
  it("scales widths relative to the largest share", () => {
    const b = shapBars([{ feature: "a", i18nKey: "k", sharePct: 40, contribution: 1, direction: "up" }, { feature: "b", i18nKey: "k", sharePct: 10, contribution: -0.2, direction: "down" }]);
    expect(b.map((x) => x.widthPct)).toEqual([100, 25]);
  });
});

describe("formatting", () => {
  it("formats money from decimal strings and handles missing values", () => {
    expect(formatMoney("18.3", "GHS", "en")).toBe("GHS 18.30");
    expect(formatMoney(null, "GHS")).toBe("—");
    expect(formatPct(-2.1)).toBe("-2.1%");
    expect(formatPct(5)).toBe("+5.0%");
  });
  it("picks localised text with fallback", () => {
    expect(pick({ en: "Maize", fr: "Maïs" }, "fr-CI")).toBe("Maïs");
    expect(pick({ en: "Maize" }, "tw")).toBe("Maize");
  });
  it("greets by time of day", () => { expect(greetingPeriod(8)).toBe("morning"); expect(greetingPeriod(20)).toBe("evening"); });
});

describe("token helpers", () => {
  it("decodes claims and decides when to refresh", () => {
    const now = Date.now();
    const fresh = jwt({ sub: "u", role: "farmer", cty: "GH", exp: Math.floor(now / 1000) + 600 });
    const soon = jwt({ sub: "u", role: "farmer", cty: "GH", exp: Math.floor(now / 1000) + 30 });
    expect(claims(fresh)?.role).toBe("farmer");
    expect(needsRefresh(fresh)).toBe(false);
    expect(needsRefresh(soon)).toBe(true);
    expect(needsRefresh(soon, 0)).toBe(false);
    expect(needsRefresh(undefined)).toBe(true);
    expect(claims("garbage")).toBeNull();
  });
});
