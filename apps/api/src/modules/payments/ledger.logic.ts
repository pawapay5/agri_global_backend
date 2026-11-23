
import Decimal from "decimal.js";

export type Direction = "debit" | "credit";
export interface Posting { account: string; kind: AccountKind; direction: Direction; amount: string }
export type AccountKind = "psp_clearing" | "escrow" | "seller" | "buyer" | "platform_fees" | "cash_on_delivery";

export const NORMAL: Record<AccountKind, Direction> = {
  psp_clearing: "debit", cash_on_delivery: "debit", escrow: "credit", seller: "credit", buyer: "credit", platform_fees: "credit",
};

export const acct = {
  psp: (provider: string, cur: string) => `psp_clearing:${provider}:${cur}`,
  escrow: (cur: string) => `escrow:${cur}`,
  seller: (id: string, cur: string) => `seller:${id}:${cur}`,
  fees: (cur: string) => `platform_fees:${cur}`,
};

const money = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const pos = (account: string, kind: AccountKind, direction: Direction, amount: Decimal): Posting => ({ account, kind, direction, amount: amount.toFixed(2) });

export function assertBalanced(p: Posting[]): void {
  const diff = p.reduce((s, x) => (x.direction === "debit" ? s.plus(x.amount) : s.minus(x.amount)), new Decimal(0));
  if (!diff.isZero()) throw new Error(`unbalanced postings (diff ${diff.toFixed(2)})`);
  if (p.some((x) => new Decimal(x.amount).lte(0))) throw new Error("posting amounts must be positive");
}

/** PSP confirmed the buyer's payment: funds now sit in PSP clearing, owed to escrow. */
export function capture(provider: string, cur: string, amount: Decimal.Value): Posting[] {
  const a = money(amount);
  return [pos(acct.psp(provider, cur), "psp_clearing", "debit", a), pos(acct.escrow(cur), "escrow", "credit", a)];
}

/** Buyer confirmed (or auto-release): escrow → seller payable minus commission → platform fees. */
export function release(sellerId: string, cur: string, amount: Decimal.Value, commission: Decimal.Value): Posting[] {
  const a = money(amount), c = money(commission);
  if (c.gt(a)) throw new Error("commission exceeds released amount");
  const out = [pos(acct.escrow(cur), "escrow", "debit", a)];
  if (a.minus(c).gt(0)) out.push(pos(acct.seller(sellerId, cur), "seller", "credit", a.minus(c)));
  if (c.gt(0)) out.push(pos(acct.fees(cur), "platform_fees", "credit", c));
  return out;
}

/** Refund back through the PSP. */
export function refund(provider: string, cur: string, amount: Decimal.Value): Posting[] {
  const a = money(amount);
  return [pos(acct.escrow(cur), "escrow", "debit", a), pos(acct.psp(provider, cur), "psp_clearing", "credit", a)];
}

/** Payout executed by the PSP to the seller's MoMo/bank account. */
export function payout(sellerId: string, provider: string, cur: string, amount: Decimal.Value): Posting[] {
  const a = money(amount);
  return [pos(acct.seller(sellerId, cur), "seller", "debit", a), pos(acct.psp(provider, cur), "psp_clearing", "credit", a)];
}

/** Failed/reversed payout: money returns to the seller balance. */
export function payoutReversal(sellerId: string, provider: string, cur: string, amount: Decimal.Value): Posting[] {
  return payout(sellerId, provider, cur, amount).map((p) => ({ ...p, direction: p.direction === "debit" ? "credit" : "debit" }));
}

/** Pay-on-delivery: cash went seller-direct, so the commission is charged against the seller balance (may go negative = owed). */
export function podCommission(sellerId: string, cur: string, commission: Decimal.Value): Posting[] {
  const c = money(commission);
  if (c.isZero()) return [];
  return [pos(acct.seller(sellerId, cur), "seller", "debit", c), pos(acct.fees(cur), "platform_fees", "credit", c)];
}

/**
 * Split dispute outcome: refund part, release the rest. Commission scales with the released share,
 * so the platform never keeps a fee on money the buyer got back.
 */
export function split(provider: string, sellerId: string, cur: string, total: Decimal.Value, refundAmount: Decimal.Value, commission: Decimal.Value) {
  const t = money(total), r = money(refundAmount);
  if (r.lte(0) || r.gte(t)) throw new Error("split refund must be between 0 and the order total");
  const releasedShare = t.minus(r);
  const c = money(new Decimal(commission).mul(releasedShare).div(t));
  return { refund: refund(provider, cur, r), release: release(sellerId, cur, releasedShare, c), commission: c.toFixed(2) };
}

// ── commission ──
export interface CommissionRule { categoryId: string | null; listingType: "product" | "service" | null; ratePct: string; minFee: string; maxFee: string | null }

/** Most specific rule wins: category+type → category → type → country default. Charged on subtotal (not delivery). */
export function commissionFor(subtotal: Decimal.Value, rules: CommissionRule[], categoryId: string | null, listingType: "product" | "service"): string {
  const score = (r: CommissionRule) =>
    (r.categoryId && r.categoryId !== categoryId) || (r.listingType && r.listingType !== listingType) ? -1 : (r.categoryId ? 2 : 0) + (r.listingType ? 1 : 0);
  const best = rules.map((r) => ({ r, s: score(r) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s)[0]?.r;
  if (!best) return "0.00";
  let fee = money(new Decimal(subtotal).mul(best.ratePct).div(100));
  if (fee.lt(best.minFee)) fee = money(best.minFee);
  if (best.maxFee != null && fee.gt(best.maxFee)) fee = money(best.maxFee);
  if (fee.gt(subtotal)) fee = money(subtotal);
  return fee.toFixed(2);
}

/** Payout guardrails. */
export function payoutDecision(amount: Decimal.Value, available: Decimal.Value, limits: { min: string; max: string; reviewAbove: string }):
  { ok: false; code: string } | { ok: true; needsReview: boolean } {
  const a = new Decimal(amount);
  if (a.lt(limits.min)) return { ok: false, code: "payout_below_minimum" };
  if (a.gt(limits.max)) return { ok: false, code: "payout_above_maximum" };
  if (a.gt(available)) return { ok: false, code: "insufficient_balance" };
  return { ok: true, needsReview: a.gt(limits.reviewAbove) };
}
