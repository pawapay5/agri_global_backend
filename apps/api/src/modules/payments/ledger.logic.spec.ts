import { describe, expect, it } from "vitest";
import { assertBalanced, capture, commissionFor, payout, payoutDecision, payoutReversal, podCommission, refund, release, split } from "./ledger.logic";

const sum = (ps: { account: string; direction: string; amount: string }[], account: string) =>
  ps.filter((p) => p.account === account).reduce((s, p) => s + (p.direction === "credit" ? 1 : -1) * Number(p.amount), 0);

describe("ledger postings", () => {
  it("every posting set balances", () => {
    for (const p of [capture("paystack", "GHS", "100"), release("s1", "GHS", "100", "5"), refund("paystack", "GHS", "100"),
      payout("s1", "paystack", "GHS", "95"), payoutReversal("s1", "paystack", "GHS", "95"), podCommission("s1", "GHS", "3")]) assertBalanced(p);
  });

  it("capture → release leaves escrow at zero and pays seller minus commission", () => {
    const all = [...capture("paystack", "GHS", "120.00"), ...release("s1", "GHS", "120.00", "6.00")];
    expect(sum(all, "escrow:GHS")).toBe(0);
    expect(sum(all, "seller:s1:GHS")).toBe(114);
    expect(sum(all, "platform_fees:GHS")).toBe(6);
  });

  it("full refund nets escrow and PSP clearing to zero", () => {
    const all = [...capture("hubtel", "GHS", "50"), ...refund("hubtel", "GHS", "50")];
    expect(sum(all, "escrow:GHS")).toBe(0);
    expect(sum(all, "psp_clearing:hubtel:GHS")).toBe(0);
  });

  it("split scales commission to the released share", () => {
    const s = split("paystack", "s1", "GHS", "100", "40", "5");
    expect(s.commission).toBe("3.00");
    assertBalanced(s.refund); assertBalanced(s.release);
    const all = [...capture("paystack", "GHS", "100"), ...s.refund, ...s.release];
    expect(sum(all, "escrow:GHS")).toBe(0);
    expect(sum(all, "seller:s1:GHS")).toBe(57);
    expect(() => split("paystack", "s1", "GHS", "100", "100", "5")).toThrow();
  });

  it("rejects commission larger than the amount", () => expect(() => release("s1", "GHS", "5", "6")).toThrow());
  it("detects unbalanced sets", () => expect(() => assertBalanced([{ account: "a", kind: "escrow", direction: "debit", amount: "1.00" }])).toThrow());
});

describe("commissionFor", () => {
  const rules = [
    { categoryId: null, listingType: null, ratePct: "5", minFee: "1.00", maxFee: "200.00" },
    { categoryId: "veg", listingType: null, ratePct: "3", minFee: "0", maxFee: null },
    { categoryId: "veg", listingType: "service" as const, ratePct: "1", minFee: "0", maxFee: null },
    { categoryId: null, listingType: "service" as const, ratePct: "8", minFee: "0", maxFee: null },
  ];
  it("picks the most specific rule", () => {
    expect(commissionFor("100", rules, "veg", "product")).toBe("3.00");
    expect(commissionFor("100", rules, "veg", "service")).toBe("1.00");
    expect(commissionFor("100", rules, "grain", "service")).toBe("8.00");
    expect(commissionFor("100", rules, "grain", "product")).toBe("5.00");
  });
  it("applies min/max and never exceeds the subtotal", () => {
    expect(commissionFor("10", rules, null, "product")).toBe("1.00");
    expect(commissionFor("10000", rules, null, "product")).toBe("200.00");
    expect(commissionFor("0.50", rules, null, "product")).toBe("0.50");
    expect(commissionFor("100", [], null, "product")).toBe("0.00");
  });
});

describe("payoutDecision", () => {
  const limits = { min: "10", max: "20000", reviewAbove: "5000" };
  it("enforces limits and the manual-review threshold", () => {
    expect(payoutDecision("5", "100", limits)).toEqual({ ok: false, code: "payout_below_minimum" });
    expect(payoutDecision("150", "100", limits)).toEqual({ ok: false, code: "insufficient_balance" });
    expect(payoutDecision("100", "100", limits)).toEqual({ ok: true, needsReview: false });
    expect(payoutDecision("6000", "9000", limits)).toEqual({ ok: true, needsReview: true });
    expect(payoutDecision("25000", "90000", limits)).toEqual({ ok: false, code: "payout_above_maximum" });
  });
});
