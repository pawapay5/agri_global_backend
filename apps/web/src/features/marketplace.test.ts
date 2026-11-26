import { describe, expect, it } from "vitest";
import { moderationHref, refundProblem } from "./admin-moderation";
import { validateListing } from "./listing-editor";
import { isTrustedPaymentUrl, normaliseMsisdn, orderRef } from "./market-common";
import { qtyProblem } from "./marketplace";
import { otherMember } from "./messages";
import { payoutProblem } from "./wallet";

describe("payment safety", () => {
  it("opens only https pages on the payment providers' domains", () => {
    expect(isTrustedPaymentUrl("https://checkout.paystack.com/x")).toBe(true);
    expect(isTrustedPaymentUrl("https://pay.hubtel.com/x")).toBe(true);
    expect(isTrustedPaymentUrl("https://hubtel.com.evil.example/x")).toBe(false);
    expect(isTrustedPaymentUrl("http://checkout.paystack.com/x")).toBe(false);
    expect(isTrustedPaymentUrl("javascript:alert(1)")).toBe(false);
  });
  it("normalises mobile-money numbers to E.164", () => {
    expect(normaliseMsisdn("+233 24 123-4567")).toBe("+233241234567");
    expect(normaliseMsisdn("0241234567")).toBeNull();
  });
  it("payouts must be positive, within limits and what's available", () => {
    expect(payoutProblem("50", 100, { min: "10", max: "1000" })).toBe(false);
    expect(payoutProblem("150", 100)).toBe(true);
    expect(payoutProblem("5", 100, { min: "10" })).toBe(true);
    expect(payoutProblem("-1", 100)).toBe(true);
    expect(payoutProblem("", 100)).toBe(true);
  });
  it("a split refund can't exceed the order total", () => {
    expect(refundProblem("40", 100)).toBe(false);
    expect(refundProblem("140", 100)).toBe(true);
    expect(refundProblem("0", 100)).toBe(true);
  });
});

describe("listing rules", () => {
  const ok = { type: "product" as const, serviceKind: "transport" as const, commodityId: "", title: "Fresh tomatoes", description: "", pricePerUnit: "12.5", currency: "GHS", unit: "kg", quantity: "300", minOrderQty: "", lowStockThreshold: "", qualityGrade: "" as const, harvestDate: "" };
  it("accepts a complete listing", () => expect(validateListing(ok)).toEqual({}));
  it("flags the contract's limits", () => {
    expect(validateListing({ ...ok, title: "ab" }).title).toBe("required");
    expect(validateListing({ ...ok, title: "x".repeat(121) }).title).toBe("tooLong");
    expect(validateListing({ ...ok, pricePerUnit: "0" }).pricePerUnit).toBe("badNumber");
    expect(validateListing({ ...ok, currency: "ghs" }).currency).toBe("required");
    expect(validateListing({ ...ok, minOrderQty: "-2" }).minOrderQty).toBe("badNumber");
  });
  it("quantity must sit between the minimum order and what's available", () => {
    expect(qtyProblem("50", 10, 300)).toBe(false);
    expect(qtyProblem("5", 10, 300)).toBe(true);
    expect(qtyProblem("400", 10, 300)).toBe(true);
    expect(qtyProblem("abc", 0, 300)).toBe(true);
  });
});

describe("helpers", () => {
  it("orderRef is short and stable", () => expect(orderRef("497f6eca-6276-4993-bfeb-53cbbbba6f08")).toBe("#497F6ECA"));
  it("otherMember picks the person who isn't me", () => {
    expect(otherMember({ members: [{ userId: "me", name: "Me" }, { userId: "you", name: "Ama" }] }, "me")?.name).toBe("Ama");
  });
  it("moderation links only for real listing ids", () => {
    expect(moderationHref({ targetType: "listing", targetId: "497f6eca-6276-4993-bfeb-53cbbbba6f08" })).toBe("/app/marketplace/497f6eca-6276-4993-bfeb-53cbbbba6f08");
    expect(moderationHref({ targetType: "listing", targetId: "../../admin" })).toBeNull();
    expect(moderationHref({ targetType: "message", targetId: "497f6eca-6276-4993-bfeb-53cbbbba6f08" })).toBeNull();
  });
});
