import { describe, expect, it } from "vitest";
import { toRows } from "./data-explorer";
import { validateReport } from "./reports";

const ok = { type: "crop_price" as const, commodityIds: ["a"], marketIds: [], from: "2026-08-01", to: "2026-11-01", sections: [] };

describe("validateReport", () => {
  it("passes a complete request", () => expect(validateReport(ok, "2026-11-25")).toEqual({}));
  it("needs a commodity and respects the contract's limits", () => {
    expect(validateReport({ ...ok, commodityIds: [] }, "2026-11-25").commodityIds).toBe("pickCommodities");
    expect(validateReport({ ...ok, commodityIds: Array.from({ length: 21 }, (_, i) => String(i)) }, "2026-11-25").commodityIds).toBe("tooMany");
    expect(validateReport({ ...ok, marketIds: Array.from({ length: 31 }, (_, i) => String(i)) }, "2026-11-25").marketIds).toBe("tooMany");
  });
  it("rejects reversed or future ranges", () => {
    expect(validateReport({ ...ok, from: "2026-11-02", to: "2026-11-01" }, "2026-11-25").dates).toBe("badRange");
    expect(validateReport({ ...ok, to: "2026-12-01" }, "2026-11-25").dates).toBe("badRange");
  });
  it("needs sections only for custom reports", () => {
    expect(validateReport({ ...ok, type: "custom" }, "2026-11-25").sections).toBe("pickSections");
    expect(validateReport({ ...ok, type: "custom", sections: ["summary"] }, "2026-11-25").sections).toBeUndefined();
  });
});

describe("toRows", () => {
  it("flattens series into dated rows, newest first, skipping points without a value", () => {
    const rows = toRows([
      { commodityId: "t", name: "Tomato", currency: "GHS", unit: "kg", points: [{ t: "2026-11-01T00:00:00Z", avg: "10", min: "9", max: "11", n: 4 }, { t: "2026-11-02T00:00:00Z", avg: "x" }] },
      { commodityId: "m", name: "Maize", currency: "GHS", unit: "kg", points: [{ t: "2026-11-02T00:00:00Z", avg: "5" }] },
    ]);
    expect(rows.map((r) => [r.date, r.commodity, r.avg, r.min])).toEqual([["2026-11-02", "Maize", 5, null], ["2026-11-01", "Tomato", 10, 9]]);
  });
});
