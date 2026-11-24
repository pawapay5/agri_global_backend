import { describe, expect, it } from "vitest";
import { easterSunday, expandHolidays } from "./holidays";

describe("holiday rules", () => {
  it("computes Easter", () => {
    expect(easterSunday(2025).toISOString().slice(0, 10)).toBe("2025-04-20");
    expect(easterSunday(2026).toISOString().slice(0, 10)).toBe("2026-04-05");
  });
  it("expands fixed, Easter-relative and nth-weekday rules", () => {
    const out = expandHolidays([
      { name: { en: "Independence" }, date: "03-06" },
      { name: { en: "Good Friday" }, easter_offset: -2 },
      { name: { en: "Farmers' Day" }, month: 12, weekday: 5, nth: 1 },
      { name: { en: "Later" }, date: "07-01", from_year: 2030 },
    ], [2026]);
    expect(out.map((h) => h.day)).toEqual(["2026-03-06", "2026-04-03", "2026-12-04"]);
  });
});
