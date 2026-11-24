/** Marketplace helpers: price sanity flag, stock status, cart splitting, delivery fees. */
import Decimal from "decimal.js";

export const FAR_ABOVE_RATIO = 1.75;   // listing ≥ 75% above market average
export const FAR_BELOW_RATIO = 0.5;    // listing ≤ 50% of market average (often bait)

export function priceFlag(listingPerKg: number | null, marketAvgPerKg: number | null): { flag: "far_above_market" | "far_below_market" | null; deviationPct: number | null } {
  if (listingPerKg == null || marketAvgPerKg == null || marketAvgPerKg <= 0) return { flag: null, deviationPct: null };
  const ratio = listingPerKg / marketAvgPerKg;
  const deviationPct = Math.round((ratio - 1) * 10_000) / 100;
  return { flag: ratio >= FAR_ABOVE_RATIO ? "far_above_market" : ratio <= FAR_BELOW_RATIO ? "far_below_market" : null, deviationPct };
}

export function stockStatus(quantity: number, lowStockThreshold: number | null, current: string): string {
  if (current === "draft" || current === "removed") return current;
  if (quantity <= 0) return "sold_out";
  if (lowStockThreshold != null && quantity <= lowStockThreshold) return "low_stock";
  return "active";
}

export interface CartLine { listingId: string; sellerId: string; currency: string; quantity: string; pricePerUnit: string; title: string; unit: string; categoryId: string | null; type: "product" | "service"; offerId: string | null }

/** One cart → one order per seller (and per currency, which in practice means per country). */
export function splitCart(lines: CartLine[]): { sellerId: string; currency: string; lines: (CartLine & { lineTotal: string })[]; subtotal: string }[] {
  const groups = new Map<string, (CartLine & { lineTotal: string })[]>();
  for (const l of lines) {
    const key = `${l.sellerId}|${l.currency}`;
    const lineTotal = new Decimal(l.quantity).mul(l.pricePerUnit).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
    groups.set(key, [...(groups.get(key) ?? []), { ...l, lineTotal }]);
  }
  return [...groups.entries()].map(([k, ls]) => {
    const [sellerId, currency] = k.split("|") as [string, string];
    return { sellerId, currency, lines: ls, subtotal: ls.reduce((s, x) => s.plus(x.lineTotal), new Decimal(0)).toFixed(2) };
  });
}

export interface DeliverySettings { pickup?: { enabled: boolean }; standard?: { enabled: boolean; fee: string; days: number; freeAbove?: string }; express?: { enabled: boolean; fee: string; days: number } }

export function deliveryFee(settings: DeliverySettings, option: "pickup" | "standard" | "express", subtotal: string): { ok: true; fee: string; days: number } | { ok: false } {
  if (option === "pickup") return settings.pickup?.enabled === false ? { ok: false } : { ok: true, fee: "0.00", days: 0 };
  const s = settings[option];
  if (!s?.enabled) return { ok: false };
  const free = option === "standard" && settings.standard?.freeAbove && new Decimal(subtotal).gte(settings.standard.freeAbove);
  return { ok: true, fee: free ? "0.00" : new Decimal(s.fee).toFixed(2), days: s.days };
}
