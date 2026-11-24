import { describe, expect, it } from "vitest";
import { deliveryFee, priceFlag, splitCart, stockStatus } from "./marketplace.logic";

describe("marketplace logic", () => {
  it("flags listings far from the market average", () => {
    expect(priceFlag(20, 10)).toEqual({ flag: "far_above_market", deviationPct: 100 });
    expect(priceFlag(4, 10)).toEqual({ flag: "far_below_market", deviationPct: -60 });
    expect(priceFlag(11, 10).flag).toBeNull();
    expect(priceFlag(11, null)).toEqual({ flag: null, deviationPct: null });
  });
  it("derives stock status", () => {
    expect(stockStatus(0, 5, "active")).toBe("sold_out");
    expect(stockStatus(3, 5, "active")).toBe("low_stock");
    expect(stockStatus(30, 5, "low_stock")).toBe("active");
    expect(stockStatus(0, null, "draft")).toBe("draft");
  });
  it("splits a cart into one order per seller", () => {
    const l = (listingId: string, sellerId: string, q: string, p: string) =>
      ({ listingId, sellerId, currency: "GHS", quantity: q, pricePerUnit: p, title: listingId, unit: "kg", categoryId: null, type: "product" as const, offerId: null });
    const out = splitCart([l("a", "s1", "2", "10.005"), l("b", "s2", "1", "5"), l("c", "s1", "3", "1")]);
    expect(out).toHaveLength(2);
    const s1 = out.find((o) => o.sellerId === "s1")!;
    expect(s1.lines.map((x) => x.lineTotal)).toEqual(["20.01", "3.00"]);
    expect(s1.subtotal).toBe("23.01");
  });
  it("computes delivery fees from seller settings", () => {
    const s = { pickup: { enabled: true }, standard: { enabled: true, fee: "15", days: 3, freeAbove: "500" }, express: { enabled: false, fee: "40", days: 1 } };
    expect(deliveryFee(s, "standard", "100")).toEqual({ ok: true, fee: "15.00", days: 3 });
    expect(deliveryFee(s, "standard", "600")).toEqual({ ok: true, fee: "0.00", days: 3 });
    expect(deliveryFee(s, "express", "100")).toEqual({ ok: false });
    expect(deliveryFee(s, "pickup", "1")).toMatchObject({ ok: true, fee: "0.00" });
  });
});
