import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });

export type Dec = Decimal;
export const D = (v: Decimal.Value) => new Decimal(v);

/** Observed amount for `unitKg` kilograms → price per kg. */
export function perKg(amount: Decimal.Value, kgPerUnit: Decimal.Value): Decimal {
  const kg = D(kgPerUnit);
  if (kg.lte(0)) throw new RangeError("kgPerUnit must be > 0");
  return D(amount).div(kg);
}

/** Local per-kg → USD per-kg given a LOCAL→USD rate (USD per 1 local). */
export function toUsd(perKgLocal: Decimal.Value, localToUsd: Decimal.Value): Decimal {
  return D(perKgLocal).mul(localToUsd);
}

export interface ConvertInput {
  perKgLocal: Decimal.Value;
  perKgUsd: Decimal.Value;
  localCurrency: string;
  targetCurrency: string;
  /** USD → target, i.e. units of target per 1 USD. Unused when target == local or USD. */
  usdToTarget?: Decimal.Value | null;
  targetKgPerUnit: Decimal.Value;
}

/**
 * Converts a normalised per-kg price into the display currency and unit.
 * Prefers the local amount when the target is the local currency (no FX round-trip drift).
 */
export function convertForDisplay(i: ConvertInput): Decimal {
  let perKgTarget: Decimal;
  if (i.targetCurrency === i.localCurrency) perKgTarget = D(i.perKgLocal);
  else if (i.targetCurrency === "USD") perKgTarget = D(i.perKgUsd);
  else {
    if (i.usdToTarget == null) throw new RangeError(`No FX rate for USD→${i.targetCurrency}`);
    perKgTarget = D(i.perKgUsd).mul(i.usdToTarget);
  }
  return perKgTarget.mul(i.targetKgPerUnit);
}

export function pctChange(current: Decimal.Value | null | undefined, previous: Decimal.Value | null | undefined): number | null {
  if (current == null || previous == null) return null;
  const p = D(previous);
  if (p.isZero()) return null;
  return D(current).minus(p).div(p).mul(100).toDecimalPlaces(2).toNumber();
}

/** Round for display according to currency minor units. */
export function fmt(v: Decimal.Value, dp = 2): string {
  return D(v).toDecimalPlaces(dp).toFixed(dp);
}
