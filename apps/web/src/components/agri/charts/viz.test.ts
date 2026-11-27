import { describe, expect, it } from "vitest";
import { roleParts } from "@/features/admin-prices";
import { moveSplit, STEADY_PCT } from "@/features/dashboard";
import { columnPath, shares } from "./viz";

describe("chart kit", () => {
  it("draws columns with a rounded data end and a square baseline", () => {
    const d = columnPath(10, 20, 24, 100);
    expect(d.startsWith("M10,120V24Q10,20 14,20")).toBe(true);
    expect(d.endsWith("V120Z")).toBe(true);
    expect(columnPath(0, 0, 10, 0)).toBe("");
  });
  it("computes shares that add up, ignoring negatives", () => {
    expect(shares([{ value: 1 }, { value: 3 }, { value: -2 }])).toEqual([25, 75, 0]);
    expect(shares([{ value: 0 }])).toEqual([0]);
  });
});

describe("dashboards", () => {
  it("splits weekly movers into rising, steady and falling", () => {
    expect(moveSplit([{ changePct: 4 }, { changePct: -2 }, { changePct: STEADY_PCT / 2 }, { changePct: -STEADY_PCT }])).toEqual({ up: 1, down: 2, steady: 1 });
  });
  it("gives the top five roles fixed colour slots and folds the rest into Other", () => {
    const parts = roleParts([
      { role: "farmer", count: 50 }, { role: "trader", count: 30 }, { role: "consumer", count: 20 }, { role: "student", count: 9 },
      { role: "researcher", count: 5 }, { role: "policymaker", count: 2 }, { role: "admin", count: 1 },
    ]);
    expect(parts.map((p) => p.key)).toEqual(["farmer", "trader", "consumer", "student", "researcher", "other"]);
    expect(parts[0]!.color).toBe("var(--viz-1)");
    expect(parts.at(-1)).toMatchObject({ count: 3, color: "var(--viz-other)" });
  });
});
