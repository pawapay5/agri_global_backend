import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without types
import { buildLookups, toCsv, transform, unitAndDivisor } from "../../scripts/wfp-to-import-csv.lib.mjs";

// Same cases as pipelines/tests for transform(): the Node converter must map exactly like the Python flow.
const lookups = buildLookups(
  [{ code: "kumasi_central", aliases: ["Kumasi"], name: { en: "Kumasi Central Market (Kejetia)" } }],
  [{ code: "maize", aliases: ["Maize", "Maize (white)"], name: { en: "Maize" } }],
);
const unitMap = { KG: "kg", "100 KG": "bag_100kg" };
const ptMap = { Wholesale: "wholesale", Retail: "retail" };
const row = (o: Record<string, string>) => ({ date: "2024-03-15", market: "Kumasi", commodity: "Maize (white)", unit: "100 KG", pricetype: "Wholesale", priceflag: "actual", currency: "GHS", price: "550", ...o });

describe("WFP → import CSV", () => {
  it("maps names, units and price types through the pack", () => {
    const { rows } = transform([row({})], lookups, unitMap, ptMap);
    expect(rows).toEqual([{ observed_at: "2024-03-15T12:00:00Z", market_code: "kumasi_central", commodity_code: "maize", price_type: "wholesale", amount: "550.0000", currency: "GHS", unit: "bag_100kg", source_ref: "wfp:2024-03-15:kumasi:maize (white):100 KG:wholesale" }]);
  });
  it("skips and counts what doesn't map, never guesses", () => {
    const { rows, skipped } = transform([
      row({ date: "#date" }), row({ market: "Nowhere" }), row({ commodity: "Gold" }), row({ unit: "Sack" }), row({ pricetype: "Farmgate" }),
      row({ price: "0" }), row({ priceflag: "forecast" }), row({ date: "2010-01-01" }),
    ], lookups, unitMap, ptMap, "2015-01-01");
    expect(rows).toEqual([]);
    expect(skipped).toEqual({ unmapped_market: 1, unmapped_commodity: 1, unmapped_unit: 1, unmapped_price_type: 1, bad_price: 1, not_actual: 1, before_since: 1 });
  });
  it("converts stated weights and counts exactly; unknown units stay skipped", () => {
    expect(unitAndDivisor("93 KG", unitMap)).toEqual(["kg", 93]);
    expect(unitAndDivisor("100 KG", unitMap)).toEqual(["bag_100kg", 1]); // explicit map wins
    expect(unitAndDivisor("100 Tubers", unitMap)).toEqual(["tuber", 100]);
    expect(unitAndDivisor("30 pcs", unitMap)).toEqual(["piece", 30]);
    expect(unitAndDivisor("Sack", unitMap)).toEqual([null, 1]);
    const { rows } = transform([row({ unit: "93 KG", price: "930" })], lookups, unitMap, ptMap);
    expect(rows[0]).toMatchObject({ unit: "kg", amount: "10.0000" });
  });
  it("writes the importer's columns", () => {
    expect(toCsv([]).split("\r\n")[0]).toBe("observed_at,market_code,commodity_code,price_type,amount,currency,unit,source_ref");
  });
});
