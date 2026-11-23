

export type OrderStatus =
  | "pending_payment" | "paid_in_escrow" | "accepted" | "in_transit" | "delivered" | "completed" | "cancelled" | "disputed" | "refunded";
export type OrderAction =
  | "pay" | "accept" | "ship" | "deliver" | "confirm" | "collect_cash" | "cancel" | "dispute" | "resolve_release" | "resolve_refund" | "resolve_split" | "timeout";
export type ActorRole = "buyer" | "seller" | "admin" | "system";
export type PaymentMethod = "momo" | "card" | "pay_on_delivery";
export type Effect = "capture_to_escrow" | "release_escrow" | "refund_full" | "refund_partial" | "charge_pod_commission" | "restock" | "decrement_stock";

export const TERMINAL: OrderStatus[] = ["completed", "cancelled", "refunded"];

export interface MachineConfig {
  paymentTimeoutMin: number;     // pending_payment → cancelled
  acceptTimeoutHours: number;    // paid_in_escrow / POD pending → cancel/refund
  shipTimeoutDays: number;       // accepted → refunded
  transitTimeoutDays: number;    // in_transit → disputed (so a human looks at it)
  releaseAfterDays: number;      // delivered → completed (escrow auto-release with no dispute)
}
export const DEFAULT_MACHINE_CONFIG: MachineConfig = { paymentTimeoutMin: 30, acceptTimeoutHours: 48, shipTimeoutDays: 5, transitTimeoutDays: 14, releaseAfterDays: 3 };

export class TransitionError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export interface TransitionResult { to: OrderStatus; effects: Effect[]; deadline: Date | null }

const H = 3_600_000, D = 24 * H;

export function deadlineFor(status: OrderStatus, method: PaymentMethod, cfg: MachineConfig, now: Date): Date | null {
  const at = (ms: number) => new Date(now.getTime() + ms);
  switch (status) {
    case "pending_payment": return at(method === "pay_on_delivery" ? cfg.acceptTimeoutHours * H : cfg.paymentTimeoutMin * 60_000);
    case "paid_in_escrow": return at(cfg.acceptTimeoutHours * H);
    case "accepted": return at(cfg.shipTimeoutDays * D);
    case "in_transit": return at(cfg.transitTimeoutDays * D);
    case "delivered": return at(cfg.releaseAfterDays * D);
    default: return null; // disputed waits for an admin; terminal states don't expire
  }
}

export function transition(
  o: { status: OrderStatus; paymentMethod: PaymentMethod },
  action: OrderAction,
  actor: ActorRole,
  now = new Date(),
  cfg: MachineConfig = DEFAULT_MACHINE_CONFIG,
): TransitionResult {
  const pod = o.paymentMethod === "pay_on_delivery";
  const deny = (why = `Cannot ${action} an order that is ${o.status}`): never => { throw new TransitionError("invalid_transition", why); };
  const need = (...roles: ActorRole[]) => { if (!roles.includes(actor)) throw new TransitionError("forbidden_transition", `${actor} cannot ${action} at ${o.status}`); };
  const go = (to: OrderStatus, effects: Effect[] = []): TransitionResult => ({ to, effects, deadline: deadlineFor(to, o.paymentMethod, cfg, now) });

  if (TERMINAL.includes(o.status)) deny();

  switch (o.status) {
    case "pending_payment":
      if (action === "pay" && !pod) { need("system"); return go("paid_in_escrow", ["capture_to_escrow"]); }
      if (action === "accept" && pod) { need("seller"); return go("accepted"); }
      if (action === "cancel") { need("buyer", "seller", "admin"); return go("cancelled", ["restock"]); }
      if (action === "timeout") { need("system"); return go("cancelled", ["restock"]); }
      return deny();

    case "paid_in_escrow":
      if (action === "accept") { need("seller"); return go("accepted"); }
      // The buyer may cancel until the seller accepts. The seller may decline.
      if (action === "cancel") { need("buyer", "seller", "admin"); return go("refunded", ["refund_full", "restock"]); }
      if (action === "timeout") { need("system"); return go("refunded", ["refund_full", "restock"]); }
      return deny();

    case "accepted":
      if (action === "ship") { need("seller"); return go("in_transit"); }
      if (action === "cancel") {
        need("seller", "admin");
        return go(pod ? "cancelled" : "refunded", pod ? ["restock"] : ["refund_full", "restock"]);
      }
      if (action === "timeout") { need("system"); return go(pod ? "cancelled" : "refunded", pod ? ["restock"] : ["refund_full", "restock"]); }
      return deny();

    case "in_transit":
      if (action === "deliver") { need("seller", "system", "admin"); return go("delivered"); }
      if (action === "dispute") { need("buyer"); return go("disputed"); }
      if (action === "timeout") { need("system"); return go("disputed"); }
      return deny();

    case "delivered":
      if (action === "confirm") { need("buyer"); return go("completed", pod ? ["charge_pod_commission"] : ["release_escrow"]); }
      if (action === "collect_cash" && pod) { need("seller"); return go("completed", ["charge_pod_commission"]); }
      if (action === "dispute") { need("buyer"); return go("disputed"); }
      if (action === "timeout") {
        need("system");
        // POD with no confirmation: we can't know cash changed hands, so escalate instead of completing.
        return pod ? go("disputed") : go("completed", ["release_escrow"]);
      }
      return deny();

    case "disputed":
      need("admin");
      if (action === "resolve_release") return go("completed", pod ? ["charge_pod_commission"] : ["release_escrow"]);
      if (action === "resolve_refund") { if (pod) deny("Pay-on-delivery disputes are settled off-platform; release or cancel instead"); return go("refunded", ["refund_full"]); }
      if (action === "resolve_split") { if (pod) deny(); return go("completed", ["refund_partial", "release_escrow"]); }
      return deny();
  }
  return deny();
}

/** Which role the caller has on this order. */
export function roleOn(order: { buyer_id: string; seller_id: string }, userId: string, isAdmin: boolean): ActorRole | null {
  if (isAdmin) return "admin";
  if (order.buyer_id === userId) return "buyer";
  if (order.seller_id === userId) return "seller";
  return null;
}
