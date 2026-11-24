/** Fertiliser calculator: reviewed per-hectare application rules × area → product, kg, bags and timing. */
import Decimal from "decimal.js";

export const HECTARES_PER: Record<string, string> = { ha: "1", acre: "0.40468564224", m2: "0.0001" };

export interface Application { stage: string; productCode: string; rateKgPerHa: number; timing: Record<string, string>; method?: Record<string, string> }
export interface Product { code: string; name: Record<string, string>; bagKg: string; n: string; p2o5: string; k2o: string }

export interface PlanLine {
  stage: string; productCode: string; productName: Record<string, string>; kg: string; bags: number; bagKg: string; bagsExact: string;
  timing: Record<string, string>; method: Record<string, string> | null; nutrientsKg: { n: string; p2o5: string; k2o: string };
}

/** Converts an area to hectares. Country packs may define local units (e.g. a "rope" or "plot") in countries.config.area_units. */
export function toHectares(area: Decimal.Value, unit: string, local: Record<string, string> = {}): Decimal {
  const f = HECTARES_PER[unit] ?? local[unit];
  if (!f) throw new RangeError(`unknown area unit ${unit}`);
  const a = new Decimal(area);
  if (a.lte(0)) throw new RangeError("area must be positive");
  return a.mul(f);
}

export function computePlan(apps: Application[], products: Map<string, Product>, hectares: Decimal.Value): PlanLine[] {
  const ha = new Decimal(hectares);
  return apps.map((a) => {
    const p = products.get(a.productCode);
    if (!p) throw new RangeError(`rule references unknown product ${a.productCode}`);
    const kg = new Decimal(a.rateKgPerHa).mul(ha);
    const exact = kg.div(p.bagKg);
    // Round bags up to the nearest half bag. Farmers can buy half bags in most markets, and this never under-supplies.
    const bags = exact.mul(2).ceil().div(2).toNumber();
    const pct = (v: string) => kg.mul(v).div(100).toDecimalPlaces(2).toFixed(2);
    return {
      stage: a.stage, productCode: a.productCode, productName: p.name, kg: kg.toDecimalPlaces(1).toFixed(1), bags, bagKg: new Decimal(p.bagKg).toFixed(0),
      bagsExact: exact.toDecimalPlaces(2).toFixed(2), timing: a.timing, method: a.method ?? null, nutrientsKg: { n: pct(p.n), p2o5: pct(p.p2o5), k2o: pct(p.k2o) },
    };
  });
}

/** Most specific published rule wins: region + farming type → region → farming type → national. */
export function pickRule<T extends { region_id: string | null; farming_type: string | null }>(rules: T[], regionIds: string[], farmingType?: string): T | undefined {
  const score = (r: T) =>
    (r.region_id && !regionIds.includes(r.region_id)) || (r.farming_type && r.farming_type !== farmingType) ? -1 : (r.region_id ? 2 : 0) + (r.farming_type ? 1 : 0);
  return rules.map((r) => ({ r, s: score(r) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s)[0]?.r;
}
