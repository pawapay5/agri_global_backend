import { describe, expect, it } from "vitest";
import { configuredProviders, isTrustedCheckoutUrl, yearlySaving } from "./billing";

describe("configuredProviders", () => {
  it("keeps known providers in order, once", () => expect(configuredProviders(" Paystack, stripe ,paystack")).toEqual(["paystack", "stripe"]));
  it("ignores unknown names", () => expect(configuredProviders("paypal, flutterwave")).toEqual(["flutterwave"]));
  it("can be empty", () => expect(configuredProviders("")).toEqual([]));
});

describe("isTrustedCheckoutUrl", () => {
  it("accepts the providers' hosted pages", () => {
    expect(isTrustedCheckoutUrl("https://checkout.paystack.com/abc123")).toBe(true);
    expect(isTrustedCheckoutUrl("https://checkout.flutterwave.com/v3/hosted/pay/x")).toBe(true);
    expect(isTrustedCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test")).toBe(true);
  });
  it("rejects lookalikes, http and other schemes", () => {
    expect(isTrustedCheckoutUrl("https://paystack.com.evil.example/pay")).toBe(false);
    expect(isTrustedCheckoutUrl("https://evilpaystack.com/pay")).toBe(false);
    expect(isTrustedCheckoutUrl("http://checkout.paystack.com/abc")).toBe(false);
    expect(isTrustedCheckoutUrl("javascript:alert(1)")).toBe(false);
    expect(isTrustedCheckoutUrl("not a url")).toBe(false);
  });
});

describe("yearlySaving", () => {
  it("rounds the saving against 12 monthly payments", () => expect(yearlySaving("50", "500")).toBe(17));
  it("is null when yearly isn't cheaper or a price is missing", () => {
    expect(yearlySaving("50", "600")).toBeNull();
    expect(yearlySaving(undefined, "500")).toBeNull();
  });
});
