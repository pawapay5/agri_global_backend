import { describe, expect, it } from "vitest";
import { DEFAULT_MACHINE_CONFIG, OrderStatus, transition } from "./order.machine";

const now = new Date("2026-06-01T00:00:00Z");
const momo = (status: OrderStatus) => ({ status, paymentMethod: "momo" as const });
const pod = (status: OrderStatus) => ({ status, paymentMethod: "pay_on_delivery" as const });

describe("order state machine (escrow)", () => {
  it("walks the happy path with the right money effects", () => {
    expect(transition(momo("pending_payment"), "pay", "system", now)).toMatchObject({ to: "paid_in_escrow", effects: ["capture_to_escrow"] });
    expect(transition(momo("paid_in_escrow"), "accept", "seller", now).to).toBe("accepted");
    expect(transition(momo("accepted"), "ship", "seller", now).to).toBe("in_transit");
    expect(transition(momo("in_transit"), "deliver", "seller", now).to).toBe("delivered");
    expect(transition(momo("delivered"), "confirm", "buyer", now)).toMatchObject({ to: "completed", effects: ["release_escrow"], deadline: null });
  });

  it("sets per-state deadlines", () => {
    const r = transition(momo("in_transit"), "deliver", "seller", now);
    expect(r.deadline!.getTime() - now.getTime()).toBe(DEFAULT_MACHINE_CONFIG.releaseAfterDays * 86_400_000);
  });

  it("auto-releases escrow N days after delivery with no dispute", () => {
    expect(transition(momo("delivered"), "timeout", "system", now)).toMatchObject({ to: "completed", effects: ["release_escrow"] });
  });

  it("refunds when the seller declines or never accepts", () => {
    expect(transition(momo("paid_in_escrow"), "cancel", "seller", now)).toMatchObject({ to: "refunded", effects: ["refund_full", "restock"] });
    expect(transition(momo("paid_in_escrow"), "timeout", "system", now).to).toBe("refunded");
    expect(transition(momo("accepted"), "timeout", "system", now).to).toBe("refunded");
  });

  it("escalates stuck shipments to a dispute rather than releasing funds", () => {
    expect(transition(momo("in_transit"), "timeout", "system", now).to).toBe("disputed");
  });

  it("only the right actor can act", () => {
    expect(() => transition(momo("paid_in_escrow"), "accept", "buyer", now)).toThrow(/cannot accept/);
    expect(() => transition(momo("delivered"), "confirm", "seller", now)).toThrow();
    expect(() => transition(momo("pending_payment"), "pay", "buyer", now)).toThrow(); // only PSP webhooks mark paid
    expect(() => transition(momo("accepted"), "cancel", "buyer", now)).toThrow();
  });

  it("disputes are resolved by admins only", () => {
    expect(() => transition(momo("disputed"), "resolve_release", "buyer", now)).toThrow();
    expect(transition(momo("disputed"), "resolve_refund", "admin", now).to).toBe("refunded");
    expect(transition(momo("disputed"), "resolve_split", "admin", now).effects).toEqual(["refund_partial", "release_escrow"]);
  });

  it("terminal states are final", () => {
    for (const s of ["completed", "cancelled", "refunded"] as const) expect(() => transition(momo(s), "cancel", "admin", now)).toThrow(/Cannot/);
  });
});

describe("order state machine (pay on delivery)", () => {
  it("skips escrow and charges commission on completion", () => {
    expect(() => transition(pod("pending_payment"), "pay", "system", now)).toThrow();
    expect(transition(pod("pending_payment"), "accept", "seller", now).to).toBe("accepted");
    expect(transition(pod("delivered"), "collect_cash", "seller", now)).toMatchObject({ to: "completed", effects: ["charge_pod_commission"] });
    expect(transition(pod("accepted"), "cancel", "seller", now)).toMatchObject({ to: "cancelled", effects: ["restock"] });
  });
  it("does not auto-complete unconfirmed POD deliveries", () => {
    expect(transition(pod("delivered"), "timeout", "system", now).to).toBe("disputed");
  });
  it("cannot refund POD through the platform", () => {
    expect(() => transition(pod("disputed"), "resolve_refund", "admin", now)).toThrow();
  });
});
