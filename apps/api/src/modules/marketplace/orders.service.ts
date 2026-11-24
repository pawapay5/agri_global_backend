import { Injectable, Logger } from "@nestjs/common";
import Decimal from "decimal.js";
import type { PoolClient } from "pg";
import type { AuthUser } from "../../common/auth/auth.common";
import { AuditService } from "../../common/audit/audit.service";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { cursor } from "../../common/http/request-context";
import { QueueService } from "../../common/queue/queues";
import { commissionFor, CommissionRule, podCommission, refund, release, capture, split } from "../payments/ledger.logic";
import { LedgerService } from "../payments/ledger.service";
import { deliveryFee, DeliverySettings, splitCart, stockStatus } from "./marketplace.logic";
import { ActorRole, DEFAULT_MACHINE_CONFIG, MachineConfig, OrderAction, OrderStatus, PaymentMethod, roleOn, transition, TransitionError } from "./order.machine";

interface OrderRow {
  id: string; checkout_id: string; buyer_id: string; seller_id: string; country_iso2: string; category_id: string | null; currency: string; status: OrderStatus;
  subtotal: string; delivery_fee: string; commission: string; total: string; payment_method: PaymentMethod; delivery_option: string; delivery_address: unknown;
  state_deadline_at: Date | null; version: number; created_at: Date;
}

const ACTIONS: OrderAction[] = ["accept", "ship", "deliver", "confirm", "collect_cash", "cancel", "dispute"];

@Injectable()
export class OrdersService {
  private readonly log = new Logger(OrdersService.name);
  constructor(private readonly sql: Sql, private readonly ledger: LedgerService, private readonly queue: QueueService, private readonly audit: AuditService) {}

  async machineConfig(country: string): Promise<MachineConfig> {
    const c = await this.sql.one<{ config: { order_timeouts?: Partial<MachineConfig> } }>(`SELECT config FROM countries WHERE iso2 = $1`, [country]);
    return { ...DEFAULT_MACHINE_CONFIG, ...(c?.config.order_timeouts ?? {}) };
  }

  allowedActions(o: Pick<OrderRow, "status" | "payment_method">, role: ActorRole | null): string[] {
    if (!role) return [];
    return ACTIONS.filter((a) => { try { transition({ status: o.status, paymentMethod: o.payment_method }, a, role); return true; } catch { return false; } });
  }

  async dto(o: OrderRow, viewer: AuthUser) {
    const role = roleOn(o, viewer.id, viewer.role === "admin");
    const [items, events, dispute] = await Promise.all([
      this.sql.many<{ listing_id: string; title: string; quantity: string; unit_code: string; price_per_unit: string; line_total: string }>(`SELECT * FROM order_items WHERE order_id = $1`, [o.id]),
      this.sql.many<{ from_status: string | null; to_status: string; actor_role: string; reason: string | null; created_at: Date }>(`SELECT from_status, to_status, actor_role, reason, created_at FROM order_events WHERE order_id = $1 ORDER BY id`, [o.id]),
      this.sql.one<{ id: string }>(`SELECT id FROM disputes WHERE order_id = $1`, [o.id]),
    ]);
    return {
      id: o.id, checkoutId: o.checkout_id, buyerId: o.buyer_id, sellerId: o.seller_id, status: o.status, currency: o.currency,
      subtotal: o.subtotal, deliveryFee: o.delivery_fee, commission: role === "buyer" ? undefined : o.commission, total: o.total,
      paymentMethod: o.payment_method, deliveryOption: o.delivery_option, stateDeadlineAt: o.state_deadline_at?.toISOString() ?? null,
      allowedActions: this.allowedActions(o, role), version: o.version,
      items: items.map((i) => ({ listingId: i.listing_id, title: i.title, quantity: i.quantity, unit: i.unit_code, pricePerUnit: i.price_per_unit, lineTotal: i.line_total })),
      events: events.map((e) => ({ from: e.from_status, to: e.to_status, actor: e.actor_role, reason: e.reason, at: e.created_at.toISOString() })),
      disputeId: dispute?.id ?? null, createdAt: o.created_at.toISOString(),
    };
  }

  async get(user: AuthUser, id: string) {
    const o = await this.sql.one<OrderRow>(`SELECT * FROM orders WHERE id = $1`, [id]);
    if (!o || !roleOn(o, user.id, user.role === "admin")) throw AppError.notFound("order");
    return this.dto(o, user);
  }

  async list(user: AuthUser, q: { role: "buyer" | "seller"; status?: string; cursor?: string; limit: number }) {
    const c = cursor.decode<{ t: string; id: string }>(q.cursor);
    const rows = await this.sql.many<OrderRow>(
      `SELECT * FROM orders WHERE ${q.role === "seller" ? "seller_id" : "buyer_id"} = $1 AND ($2::text IS NULL OR status = $2)
         AND ($3::timestamptz IS NULL OR (created_at, id) < ($3, $4::uuid)) ORDER BY created_at DESC, id DESC LIMIT $5`,
      [user.id, q.status ?? null, c?.t ?? null, c?.id ?? null, q.limit + 1]);
    const page = rows.slice(0, q.limit); const last = page[page.length - 1];
    return { data: await Promise.all(page.map((o) => this.dto(o, user))), nextCursor: rows.length > q.limit && last ? cursor.encode({ t: last.created_at.toISOString(), id: last.id }) : null };
  }

  // ── checkout ──
  async checkout(user: AuthUser, d: { paymentMethod: PaymentMethod; delivery: { sellerId: string; option: "pickup" | "standard" | "express" }[]; address?: unknown }, idempotencyKey?: string) {
    if (idempotencyKey) {
      const prev = await this.sql.one<{ id: string }>(`SELECT id FROM checkouts WHERE buyer_id = $1 AND idempotency_key = $2`, [user.id, idempotencyKey]);
      if (prev) return this.checkoutResult(user, prev.id);
    }
    const lines = await this.sql.many<{ listing_id: string; seller_id: string; currency: string; quantity: string; cart_qty: string; price_per_unit: string; offer_price: string | null; offer_qty: string | null;
      offer_id: string | null; title: string; unit_code: string; category_id: string | null; type: "product" | "service"; status: string; min_order_qty: string; country_iso2: string; delivery_settings: DeliverySettings }>(
      `SELECT ci.listing_id, l.seller_id, l.currency, l.quantity::text, ci.quantity::text AS cart_qty, l.price_per_unit::text, o.price_per_unit::text AS offer_price, o.quantity::text AS offer_qty,
              ci.offer_id, l.title, l.unit_code, l.category_id, l.type, l.status, l.min_order_qty::text, l.country_iso2, sp.delivery_settings
       FROM cart_items ci JOIN listings l ON l.id = ci.listing_id JOIN seller_profiles sp ON sp.user_id = l.seller_id
       LEFT JOIN offers o ON o.id = ci.offer_id AND o.status = 'accepted' AND o.buyer_id = $1 AND o.expires_at > now()
       WHERE ci.user_id = $1`, [user.id]);
    if (!lines.length) throw AppError.unprocessable("cart_empty", "Your cart is empty");
    for (const l of lines) {
      if (l.seller_id === user.id) throw AppError.unprocessable("own_listing", `You can't buy your own listing "${l.title}"`);
      if (!["active", "low_stock"].includes(l.status)) throw AppError.conflict("listing_unavailable", `"${l.title}" is no longer available`);
      if (l.offer_id && !l.offer_price) throw AppError.conflict("offer_expired", `The accepted offer for "${l.title}" has expired`);
      const qty = new Decimal(l.offer_qty ?? l.cart_qty);
      if (qty.lt(l.min_order_qty)) throw AppError.unprocessable("below_min_order", `"${l.title}" has a minimum order of ${l.min_order_qty} ${l.unit_code}`);
      if (qty.gt(l.quantity)) throw AppError.conflict("insufficient_stock", `Only ${l.quantity} ${l.unit_code} of "${l.title}" left`);
    }
    const country = lines[0]!.country_iso2;
    const cfg = await this.sql.one<{ config: { pod_max_total?: string; pod_enabled?: boolean } }>(`SELECT config FROM countries WHERE iso2 = $1`, [country]);
    const rules = (await this.sql.many<{ category_id: string | null; listing_type: "product" | "service" | null; rate_pct: string; min_fee: string; max_fee: string | null }>(
      `SELECT category_id, listing_type, rate_pct::text, min_fee::text, max_fee::text FROM commission_rules WHERE country_iso2 = $1 AND active`, [country]))
      .map<CommissionRule>((r) => ({ categoryId: r.category_id, listingType: r.listing_type, ratePct: r.rate_pct, minFee: r.min_fee, maxFee: r.max_fee }));

    const groups = splitCart(lines.map((l) => ({
      listingId: l.listing_id, sellerId: l.seller_id, currency: l.currency, quantity: l.offer_qty ?? l.cart_qty, pricePerUnit: l.offer_price ?? l.price_per_unit,
      title: l.title, unit: l.unit_code, categoryId: l.category_id, type: l.type, offerId: l.offer_price ? l.offer_id : null,
    })));
    const mcfg = await this.machineConfig(country);
    const now = new Date();

    const checkoutId = await this.sql.tx(async (c) => {
      const plan = groups.map((g) => {
        const choice = d.delivery.find((x) => x.sellerId === g.sellerId)?.option ?? "pickup";
        const settings = lines.find((l) => l.seller_id === g.sellerId)!.delivery_settings;
        const fee = deliveryFee(settings, choice, g.subtotal);
        if (!fee.ok) throw AppError.unprocessable("delivery_unavailable", `This seller doesn't offer ${choice} delivery`);
        const commission = g.lines.reduce((s, l) => s.plus(commissionFor(l.lineTotal, rules, l.categoryId, l.type)), new Decimal(0)).toFixed(2);
        const total = new Decimal(g.subtotal).plus(fee.fee).toFixed(2);
        return { g, choice, fee: fee.fee, commission, total };
      });
      if (d.paymentMethod === "pay_on_delivery") {
        if (cfg?.config.pod_enabled === false) throw AppError.unprocessable("pod_unavailable", "Pay on delivery isn't available in this country");
        const max = cfg?.config.pod_max_total ?? "2000";
        if (plan.some((p) => new Decimal(p.total).gt(max))) throw AppError.unprocessable("pod_limit", `Pay on delivery is limited to ${max} per order`);
      }
      const grand = plan.reduce((s, p) => s.plus(p.total), new Decimal(0)).toFixed(2);
      const ch = await c.query<{ id: string }>(`INSERT INTO checkouts (buyer_id, currency, total, idempotency_key) VALUES ($1,$2,$3,$4) RETURNING id`,
        [user.id, groups[0]!.currency, grand, idempotencyKey ?? null]);
      for (const p of plan) {
        const deadline = new Date(now.getTime() + (d.paymentMethod === "pay_on_delivery" ? mcfg.acceptTimeoutHours * 3_600_000 : mcfg.paymentTimeoutMin * 60_000));
        const o = await c.query<{ id: string }>(
          `INSERT INTO orders (checkout_id, buyer_id, seller_id, country_iso2, category_id, currency, subtotal, delivery_fee, commission, total, payment_method, delivery_option, delivery_address, state_deadline_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
          [ch.rows[0]!.id, user.id, p.g.sellerId, country, p.g.lines[0]!.categoryId, p.g.currency, p.g.subtotal, p.fee, p.commission, p.total, d.paymentMethod, p.choice,
            p.choice === "pickup" ? null : JSON.stringify(d.address ?? null), deadline]);
        for (const l of p.g.lines) {
          await c.query(`INSERT INTO order_items (order_id, listing_id, offer_id, title, quantity, unit_code, price_per_unit, line_total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [o.rows[0]!.id, l.listingId, l.offerId, l.title, l.quantity, l.unit, l.pricePerUnit, l.lineTotal]);
          // Reserve stock atomically; a concurrent buyer may have taken it.
          const r = await c.query(`UPDATE listings SET quantity = quantity - $2 WHERE id = $1 AND quantity >= $2 AND status IN ('active','low_stock')`, [l.listingId, l.quantity]);
          if (!r.rowCount) throw AppError.conflict("insufficient_stock", `"${l.title}" just sold out`);
          await this.refreshStock(c, l.listingId);
          if (l.offerId) await c.query(`UPDATE offers SET status = 'used' WHERE id = $1`, [l.offerId]);
        }
        await c.query(`INSERT INTO order_events (order_id, to_status, actor_id, actor_role) VALUES ($1, 'pending_payment', $2, 'buyer')`, [o.rows[0]!.id, user.id]);
      }
      await c.query(`DELETE FROM cart_items WHERE user_id = $1`, [user.id]);
      return ch.rows[0]!.id;
    });

    for (const g of groups) {
      await this.queue.dispatch({ userId: g.sellerId, category: "market_update", templateKey: "order.new", params: { title: "New order", body: `You have a new order (${g.currency} ${g.subtotal}).` },
        data: { checkoutId }, dedupeKey: `order_new:${checkoutId}:${g.sellerId}` });
    }
    await this.audit.record({ actorId: user.id, action: "order.checkout", entity: "checkout", entityId: checkoutId, data: { orders: groups.length, method: d.paymentMethod } });
    return this.checkoutResult(user, checkoutId);
  }

  private async checkoutResult(user: AuthUser, checkoutId: string) {
    const ch = await this.sql.one<{ total: string; currency: string }>(`SELECT total::text, currency FROM checkouts WHERE id = $1 AND buyer_id = $2`, [checkoutId, user.id]);
    const orders = await this.sql.many<OrderRow>(`SELECT * FROM orders WHERE checkout_id = $1 ORDER BY created_at`, [checkoutId]);
    return { checkoutId, total: ch!.total, currency: ch!.currency, orders: await Promise.all(orders.map((o) => this.dto(o, user))) };
  }

  async refreshStock(c: PoolClient, listingId: string) {
    const l = (await c.query<{ quantity: string; low_stock_threshold: string | null; status: string }>(`SELECT quantity, low_stock_threshold, status FROM listings WHERE id = $1`, [listingId])).rows[0];
    if (!l) return;
    const next = stockStatus(Number(l.quantity), l.low_stock_threshold == null ? null : Number(l.low_stock_threshold), l.status);
    if (next !== l.status) await c.query(`UPDATE listings SET status = $2 WHERE id = $1`, [listingId, next]);
  }

  // ── transitions ──
  async transitionAs(user: AuthUser, id: string, d: { action: OrderAction; reason?: string; disputeReason?: string; expectedVersion?: number }) {
    const o = await this.sql.one<OrderRow>(`SELECT * FROM orders WHERE id = $1`, [id]);
    const role = o && roleOn(o, user.id, false);
    if (!o || !role) throw AppError.notFound("order");
    if (d.action === "dispute" && !d.disputeReason) throw AppError.unprocessable("dispute_reason_required", "Choose a dispute reason");
    await this.apply(id, d.action, { userId: user.id, role }, { reason: d.reason, disputeReason: d.disputeReason, expectedVersion: d.expectedVersion });
    return this.get(user, id);
  }

  /**
   * The single place order state changes. Row lock + version check, state machine, ledger effects,
   * stock and event log: all in one DB transaction. Refunds and notifications are queued after commit.
   */
  async apply(orderId: string, action: OrderAction, actor: { userId: string | null; role: ActorRole },
    opts: { reason?: string; disputeReason?: string; expectedVersion?: number; refundAmount?: string; paymentId?: string } = {}) {
    const after: (() => Promise<unknown>)[] = [];
    const result = await this.sql.tx(async (c) => {
      const o = (await c.query<OrderRow>(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [orderId])).rows[0];
      if (!o) throw AppError.notFound("order");
      if (opts.expectedVersion != null && opts.expectedVersion !== o.version) throw AppError.conflict("order_changed", "The order changed; refresh and try again");
      const cfg = await this.machineConfig(o.country_iso2);
      let t;
      try { t = transition({ status: o.status, paymentMethod: o.payment_method }, action, actor.role, new Date(), cfg); }
      catch (e) { if (e instanceof TransitionError) throw AppError.conflict(e.code, e.message); throw e; }

      const ts: Record<string, string> = { paid_in_escrow: "paid_at", accepted: "accepted_at", in_transit: "shipped_at", delivered: "delivered_at", completed: "completed_at", cancelled: "cancelled_at", refunded: "cancelled_at" };
      await c.query(`UPDATE orders SET status = $2, state_deadline_at = $3, version = version + 1${ts[t.to] ? `, ${ts[t.to]} = now()` : ""} WHERE id = $1`, [o.id, t.to, t.deadline]);
      await c.query(`INSERT INTO order_events (order_id, from_status, to_status, actor_id, actor_role, reason) VALUES ($1,$2,$3,$4,$5,$6)`,
        [o.id, o.status, t.to, actor.userId, actor.role, opts.reason ?? opts.disputeReason ?? null]);

      const pay = (await c.query<{ id: string; provider: string; amount: string }>(
        `SELECT id, provider, amount::text FROM payments WHERE order_id = $1 AND status IN ('succeeded','partially_refunded') ORDER BY created_at DESC LIMIT 1`, [o.id])).rows[0];

      for (const eff of t.effects) {
        if (eff === "capture_to_escrow") {
          const p = opts.paymentId ? (await c.query<{ id: string; provider: string; amount: string }>(`SELECT id, provider, amount::text FROM payments WHERE id = $1`, [opts.paymentId])).rows[0] : pay;
          if (!p) throw new Error("capture without a succeeded payment");
          await this.ledger.post("payment_captured", `capture:${p.id}`, capture(p.provider, o.currency, p.amount), { orderId: o.id, paymentId: p.id }, c);
        } else if (eff === "release_escrow" && !t.effects.includes("refund_partial")) {
          await this.ledger.post("escrow_release", `release:${o.id}`, release(o.seller_id, o.currency, o.total, o.commission), { orderId: o.id }, c);
        } else if (eff === "refund_partial") {
          if (!pay || !opts.refundAmount) throw AppError.unprocessable("refund_amount_required", "Provide the refund amount for a split decision");
          const s = split(pay.provider, o.seller_id, o.currency, o.total, opts.refundAmount, o.commission);
          await this.ledger.post("refund", `refund:${o.id}`, s.refund, { orderId: o.id, paymentId: pay.id, memo: "split" }, c);
          await this.ledger.post("escrow_release", `release:${o.id}`, s.release, { orderId: o.id, memo: "split" }, c);
          await c.query(`UPDATE orders SET commission = $2 WHERE id = $1`, [o.id, s.commission]);
          after.push(() => this.queue.raw("commerce", "refund-execute", { orderId: o.id, paymentId: pay.id, amount: new Decimal(opts.refundAmount!).toFixed(2) }, `refund_${o.id}`));
        } else if (eff === "refund_full") {
          if (pay) {
            await this.ledger.post("refund", `refund:${o.id}`, refund(pay.provider, o.currency, pay.amount), { orderId: o.id, paymentId: pay.id }, c);
            after.push(() => this.queue.raw("commerce", "refund-execute", { orderId: o.id, paymentId: pay.id, amount: pay.amount }, `refund_${o.id}`));
          }
        } else if (eff === "charge_pod_commission") {
          await this.ledger.post("adjustment", `podfee:${o.id}`, podCommission(o.seller_id, o.currency, o.commission), { orderId: o.id, memo: "pay-on-delivery commission" }, c);
        } else if (eff === "restock") {
          const items = (await c.query<{ listing_id: string; quantity: string }>(`SELECT listing_id, quantity::text FROM order_items WHERE order_id = $1`, [o.id])).rows;
          for (const it of items) {
            await c.query(`UPDATE listings SET quantity = quantity + $2, status = CASE WHEN status = 'sold_out' THEN 'active' ELSE status END WHERE id = $1`, [it.listing_id, it.quantity]);
            await this.refreshStock(c, it.listing_id);
          }
        }
      }
      if (t.to === "disputed") {
        await c.query(`INSERT INTO disputes (order_id, opened_by, reason, description) VALUES ($1,$2,$3,$4) ON CONFLICT (order_id) DO NOTHING`,
          [o.id, actor.userId ?? o.buyer_id, opts.disputeReason ?? "other", opts.reason ?? (actor.role === "system" ? "Opened automatically after a timeout" : "")]);
      }
      return { order: o, to: t.to };
    });

    const { order, to } = result;
    for (const f of after) await f().catch((e) => this.log.error({ err: e, orderId }, "post-commit job failed"));
    const notify = (userId: string) => this.queue.dispatch({
      userId, category: "market_update", templateKey: "order.status", params: { title: "Order update", body: `Your order is now ${to.replace(/_/g, " ")}.` },
      data: { orderId }, dedupeKey: `order_status:${orderId}:${to}:${userId}`,
    });
    if (actor.role !== "buyer") await notify(order.buyer_id);
    if (actor.role !== "seller") await notify(order.seller_id);
    await this.audit.record({ actorId: actor.userId, action: `order.${action}`, entity: "order", entityId: orderId, data: { from: order.status, to, role: actor.role } });
    return to;
  }

  async review(user: AuthUser, orderId: string, d: { rating: number; comment?: string }) {
    const o = await this.sql.one<OrderRow>(`SELECT * FROM orders WHERE id = $1`, [orderId]);
    if (!o || o.buyer_id !== user.id) throw AppError.notFound("order");
    if (o.status !== "completed") throw AppError.unprocessable("order_not_completed", "You can review only after the order is completed");
    const r = await this.sql.one<{ id: string }>(
      `INSERT INTO reviews (order_id, reviewer_id, seller_id, rating, comment) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (order_id, reviewer_id) DO NOTHING RETURNING id`,
      [o.id, user.id, o.seller_id, d.rating, d.comment ?? null]);
    if (!r) throw AppError.conflict("already_reviewed", "You already reviewed this order");
    await this.sql.exec(
      `UPDATE seller_profiles SET rating_avg = s.avg, rating_count = s.n FROM (SELECT avg(rating)::numeric(3,2) AS avg, count(*)::int AS n FROM reviews WHERE seller_id = $1) s WHERE user_id = $1`, [o.seller_id]);
    return { id: r.id, orderId, rating: d.rating, comment: d.comment ?? null };
  }

  /** Timeout sweep (scheduler): every order whose state deadline passed gets a system `timeout`. */
  async sweepTimeouts(limit = 200): Promise<number> {
    const due = await this.sql.many<{ id: string }>(
      `SELECT id FROM orders WHERE state_deadline_at <= now() AND status NOT IN ('completed','cancelled','refunded','disputed') ORDER BY state_deadline_at LIMIT $1`, [limit]);
    let n = 0;
    for (const { id } of due) {
      try { await this.apply(id, "timeout", { userId: null, role: "system" }); n++; }
      catch (e) { this.log.warn({ orderId: id, err: (e as Error).message }, "timeout transition skipped"); }
    }
    return n;
  }
}
