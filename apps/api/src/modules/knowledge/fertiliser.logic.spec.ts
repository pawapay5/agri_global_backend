import { describe, expect, it } from "vitest";
import { computePlan, pickRule, toHectares } from "./fertiliser.logic";

// Synthetic test fixture: rule numbers here are not agronomic advice.
const products = new Map([
  ["npk", { code: "npk", name: { en: "NPK 15-15-15" }, bagKg: "50", n: "15", p2o5: "15", k2o: "15" }],
  ["urea", { code: "urea", name: { en: "Urea" }, bagKg: "50", n: "46", p2o5: "0", k2o: "0" }],
]);
const apps = [
  { stage: "basal", productCode: "npk", rateKgPerHa: 200, timing: { en: "At planting" } },
  { stage: "top_dress", productCode: "urea", rateKgPerHa: 90, timing: { en: "Later" } },
];

describe("fertiliser calculator", () => {
  it("converts area units", () => {
    expect(toHectares(2.5, "acre").toFixed(4)).toBe("1.0117");
    expect(toHectares(5000, "m2").toFixed(2)).toBe("0.50");
    expect(toHectares(4, "rope", { rope: "0.0625" }).toFixed(2)).toBe("0.25");
    expect(() => toHectares(1, "plot")).toThrow(/unknown area unit/);
    expect(() => toHectares(0, "ha")).toThrow();
  });
  it("computes kg, bags rounded up to half bags, and nutrients", () => {
    const plan = computePlan(apps, products, "1.0117");
    expect(plan[0]).toMatchObject({ kg: "202.3", bagsExact: "4.05", bags: 4.5, nutrientsKg: { n: "30.35" } });
    expect(plan[1]).toMatchObject({ kg: "91.1", bags: 2 });
  });
  it("rejects rules that reference missing products", () => {
    expect(() => computePlan([{ stage: "x", productCode: "nope", rateKgPerHa: 1, timing: {} }], products, 1)).toThrow();
  });
  it("picks the most specific applicable rule", () => {
    const rules = [
      { id: "nat", region_id: null, farming_type: null }, { id: "reg", region_id: "r1", farming_type: null },
      { id: "irr", region_id: null, farming_type: "irrigated" }, { id: "other", region_id: "r9", farming_type: null },
    ];
    expect(pickRule(rules, ["r1"])!.id).toBe("reg");
    expect(pickRule(rules, ["r2"], "irrigated")!.id).toBe("irr");
    expect(pickRule(rules, ["r2"])!.id).toBe("nat");
    expect(pickRule([], ["r1"])).toBeUndefined();
  });
});
