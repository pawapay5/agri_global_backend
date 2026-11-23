import { Injectable, Logger } from "@nestjs/common";
import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import type { AuthUser } from "../../common/auth/auth.common";
import { AuditService } from "../../common/audit/audit.service";
import { FieldCipher } from "../../common/crypto/crypto";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { cursor } from "../../common/http/request-context";
import { claimWebhookEvent, markWebhookProcessed, RawRequest, verifyWebhook } from "../../common/http/webhooks";
import { QueueService } from "../../common/queue/queues";
import { StorageService } from "../../common/storage/storage.service";
import { OrdersService } from "../marketplace/orders.service";
import { acct, payout, payoutDecision, payoutReversal } from "./ledger.logic";
import { LedgerService } from "./ledger.service";
import { Network, psp } from "./psp";

/** PSP transfer reference: 32 chars max (Hubtel ClientReference limit). */
export const poRef = (id: string) => `po${id.replace(/-/g, "").slice(0, 30)}`;

const DEFAULT_PAYOUT_LIMITS = { min: "10.00", max: "20000.00", reviewAbove: "5000.00" };

@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);
  constructor(
    private readonly sql: Sql, private readonly ledger: LedgerService, private readonly orders: OrdersService, private readonly queue: QueueService,
    private readonly audit: AuditService, private readonly cipher: FieldCipher, private readonly storage: StorageService,
  ) {}

  // ── collections ──
  async pay(user: AuthUser, orderId: string, d: { provider: string; method?: "momo" | "card"; network?: Network; msisdn?: string; paymentMethodId?: string; saveMethod?: boolean }, idem?: string) {
    const o = await this.sql.one<{ id: string; buyer_id: string; status: string; total: string; currency: string; payment_method: string }>(`SELECT id, buyer_id, status, total::text, currency, payment_method FROM orders WHERE id = $1`, [orderId]);
    if (!o || o.buyer_id !== user.id) throw AppError.notFound("order");
    if (o.payment_method === "pay_on_delivery") throw AppError.unprocessable("pay_on_delivery", "This order is paid on delivery");
    if (o.status !== "pending_payment") throw AppError.conflict("order_not_payable", `Order is ${o.status}`);
    const reference = `pay_${idem ? idem.replace(/[^\w-]/g, "").slice(0, 40) + "_" + orderId.slice(0, 8) : randomUUID()}`;
    const existing = await this.sql.one<{ id: string; status: string; reference: string }>(`SELECT id, status, reference FROM payments WHERE reference = $1`, [reference]);
    if (existing) return { paymentId: existing.id, reference, status: existing.status, authorizationUrl: null, displayText: null };

    let token: string | undefined, method = d.method;
    if (d.paymentMethodId) {
      const pm = await this.sql.one<{ token: string; type: "card" | "momo"; provider: string }>(`SELECT token, type, provider FROM payment_methods WHERE id = $1 AND user_id = $2`, [d.paymentMethodId, user.id]);
      if (!pm || pm.provider !== d.provider) throw AppError.unprocessable("payment_method_invalid", "Saved method not found for this provider");
      token = pm.token; method = pm.type;
    }
    if (!method) throw AppError.unprocessable("method_required", "Choose momo or card");
    if (method === "momo" && !token && (!d.msisdn || !d.network)) throw AppError.unprocessable("momo_details_required", "Enter the mobile money number and network");
    const email = (await this.sql.one<{ email: string | null }>(`SELECT email FROM users WHERE id = $1`, [user.id]))?.email ?? null;

    const pay = await this.sql.one<{ id: string }>(
      `INSERT INTO payments (order_id, payer_id, provider, method, network, reference, amount, currency, payer_msisdn_enc) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [orderId, user.id, d.provider, method, d.network ?? null, reference, o.total, o.currency, d.msisdn ? this.cipher.encrypt(d.msisdn) : null]);
    try {
      const r = await psp(d.provider).collect({
        reference, amount: o.total, currency: o.currency, email, method, msisdn: d.msisdn, network: d.network, token,
        callbackUrl: `${process.env.WEB_URL ?? "https://agriprice.app"}/orders/${orderId}`,
        metadata: { userId: user.id, orderId, paymentId: pay!.id, saveMethod: d.saveMethod ? "1" : "0" },
      });
      await this.sql.exec(`UPDATE payments SET status = $2, provider_ref = $3 WHERE id = $1`, [pay!.id, r.status === "succeeded" ? "pending" : r.status, r.providerRef]);
      // Even an immediate "success" is confirmed through verify() so there's one code path.
      if (r.status === "succeeded") await this.confirm(d.provider, reference);
      const now = await this.sql.one<{ status: string }>(`SELECT status FROM payments WHERE id = $1`, [pay!.id]);
      return { paymentId: pay!.id, reference, status: now!.status, authorizationUrl: r.authorizationUrl, displayText: r.displayText };
    } catch (e) {
      await this.sql.exec(`UPDATE payments SET status = 'failed', failure_reason = $2 WHERE id = $1`, [pay!.id, (e as Error).message.slice(0, 300)]);
      throw e;
    }
  }

  /** Re-verifies with the PSP (never trusting webhook payload amounts) and moves the order into escrow. */
  async confirm(provider: string, reference: string) {
    const p = await this.sql.one<{ id: string; order_id: string; amount: string; currency: string; status: string; payer_id: string }>(
      `SELECT id, order_id, amount::text, currency, status, payer_id FROM payments WHERE reference = $1 AND provider = $2`, [reference, provider]);
    if (!p || p.status === "succeeded") return;
    const v = await psp(provider).verify(reference);
    if (v.status === "pending") return;
    if (v.status === "failed") { await this.sql.exec(`UPDATE payments SET status = 'failed' WHERE id = $1`, [p.id]); return; }
    if (!new Decimal(v.amount).eq(p.amount) || v.currency !== p.currency) {
      await this.sql.exec(`UPDATE payments SET status = 'failed', failure_reason = 'amount_mismatch' WHERE id = $1`, [p.id]);
      await this.audit.record({ actorId: null, action: "payment.amount_mismatch", entity: "payment", entityId: p.id, data: { expected: p.amount, got: v.amount, currency: v.currency } });
      return;
    }
    await this.sql.exec(`UPDATE payments SET status = 'succeeded', provider_ref = $2 WHERE id = $1 AND status <> 'succeeded'`, [p.id, v.providerRef]);
    const order = await this.sql.one<{ status: string }>(`SELECT status FROM orders WHERE id = $1`, [p.order_id]);
    if (order?.status === "pending_payment") {
      await this.orders.apply(p.order_id, "pay", { userId: null, role: "system" }, { paymentId: p.id });
    } else {
      // Paid after the order timed out: refund automatically.
      await this.ledger.post("payment_captured", `capture:${p.id}`, [
        { account: acct.psp(provider, p.currency), kind: "psp_clearing", direction: "debit", amount: p.amount },
        { account: acct.escrow(p.currency), kind: "escrow", direction: "credit", amount: p.amount }], { orderId: p.order_id, paymentId: p.id, memo: "late payment" });
      await this.ledger.post("refund", `refund:late:${p.id}`, [
        { account: acct.escrow(p.currency), kind: "escrow", direction: "debit", amount: p.amount },
        { account: acct.psp(provider, p.currency), kind: "psp_clearing", direction: "credit", amount: p.amount }], { orderId: p.order_id, paymentId: p.id, memo: "late payment" });
      await this.queue.raw("commerce", "refund-execute", { orderId: p.order_id, paymentId: p.id, amount: p.amount }, `refund_late_${p.id}`);
    }
    const meta = await this.sql.one<{ save: boolean }>(`SELECT (payload->'data'->'metadata'->>'saveMethod') = '1' AS save FROM webhook_events WHERE provider = $1 AND payload->'data'->>'reference' = $2 LIMIT 1`, [provider, reference]);
    if (v.token && (meta?.save ?? false)) {
      await this.sql.exec(`INSERT INTO payment_methods (user_id, provider, type, token, label) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (provider, token) DO NOTHING`,
        [p.payer_id, provider, v.token.type, v.token.value, v.token.label]);
    }
  }

  async webhook(provider: string, req: RawRequest) {
    verifyWebhook(provider, req);
    const b = req.body as Record<string, any>;
    let eventId: string, reference: string | undefined, kind: "charge" | "transfer" | "refund" | "other" = "other", status = "";
    if (provider === "paystack") {
      eventId = `${b.event}:${b.data?.id}`; reference = b.data?.reference; status = b.data?.status;
      kind = String(b.event).startsWith("charge") ? "charge" : String(b.event).startsWith("transfer") ? "transfer" : String(b.event).startsWith("refund") ? "refund" : "other";
      if (kind === "transfer") status = b.event === "transfer.success" ? "succeeded" : b.event === "transfer.failed" || b.event === "transfer.reversed" ? "failed" : "pending";
    } else if (provider === "flutterwave") {
      // Flutterwave transfers echo our reference as data.reference
      eventId = `${b.event ?? b["event.type"]}:${b.data?.id}`; reference = b.data?.tx_ref ?? b.data?.reference;
      kind = String(b.event).startsWith("transfer") ? "transfer" : "charge";
      status = String(b.data?.status ?? "").toUpperCase() === "SUCCESSFUL" ? "succeeded" : String(b.data?.status ?? "").toUpperCase() === "FAILED" ? "failed" : "pending";
    } else {
      const d = b.Data ?? b.data ?? {};
      reference = d.ClientReference ?? d.clientReference; eventId = `${reference}:${d.TransactionId ?? d.transactionId}:${b.ResponseCode}`;
      kind = /^po[0-9a-f]{30}$/.test(String(reference ?? "")) ? "transfer" : "charge";
      status = b.ResponseCode === "0000" ? "succeeded" : "failed";
    }
    if (!reference || !(await claimWebhookEvent(this.sql, provider, eventId, "payments", kind, b))) return { ok: true };
    try {
      if (kind === "charge") await this.confirm(provider, reference);
      else if (kind === "transfer") await this.payoutResult(reference, status);
      await markWebhookProcessed(this.sql, provider, eventId);
    } catch (e) {
      await markWebhookProcessed(this.sql, provider, eventId, (e as Error).message);
      throw e;
    }
    return { ok: true };
  }

  async methods(user: AuthUser) {
    return (await this.sql.many<{ id: string; provider: string; type: string; label: string; is_default: boolean }>(`SELECT id, provider, type, label, is_default FROM payment_methods WHERE user_id = $1 ORDER BY created_at DESC`, [user.id]))
      .map((m) => ({ id: m.id, provider: m.provider, type: m.type, label: m.label, isDefault: m.is_default }));
  }
  async deleteMethod(user: AuthUser, id: string) {
    if (!(await this.sql.exec(`DELETE FROM payment_methods WHERE id = $1 AND user_id = $2`, [id, user.id]))) throw AppError.notFound("payment_method");
  }

  // ── wallet & payouts ──
  private async limits(country: string) {
    const c = await this.sql.one<{ currency: string; config: { payout_limits?: typeof DEFAULT_PAYOUT_LIMITS } }>(`SELECT currency, config FROM countries WHERE iso2 = $1`, [country]);
    return { currency: c!.currency, limits: { ...DEFAULT_PAYOUT_LIMITS, ...(c!.config.payout_limits ?? {}) } };
  }

  async wallet(user: AuthUser) {
    const { currency, limits } = await this.limits(user.country);
    const [available, escrow, pending, lifetime] = await Promise.all([
      this.ledger.balance(acct.seller(user.id, currency)),
      this.sql.one<{ v: string }>(`SELECT coalesce(sum(total - commission), 0)::numeric(18,2)::text AS v FROM orders WHERE seller_id = $1 AND currency = $2 AND payment_method <> 'pay_on_delivery'
                                    AND status IN ('paid_in_escrow','accepted','in_transit','delivered','disputed')`, [user.id, currency]),
      this.sql.one<{ v: string }>(`SELECT coalesce(sum(amount), 0)::numeric(18,2)::text AS v FROM payouts WHERE seller_id = $1 AND currency = $2 AND status IN ('requested','pending_review','approved','processing')`, [user.id, currency]),
      this.sql.one<{ v: string }>(`SELECT coalesce(sum(e.amount), 0)::numeric(18,2)::text AS v FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
                                    JOIN ledger_transactions t ON t.id = e.transaction_id WHERE a.code = $1 AND e.direction = 'credit' AND t.kind = 'escrow_release'`, [acct.seller(user.id, currency)]),
    ]);
    return { currency, available, inEscrow: escrow!.v, pendingPayouts: pending!.v, lifetimeEarnings: lifetime!.v, limits };
  }

  async ledgerEntries(user: AuthUser, q: { cursor?: string; limit: number }) {
    const c = cursor.decode<{ id: number }>(q.cursor);
    const { currency } = await this.limits(user.country);
    const rows = await this.sql.many<{ id: number; direction: string; amount: string; kind: string; memo: string | null; order_id: string | null; created_at: Date }>(
      `SELECT e.id, e.direction, e.amount::text, t.kind, t.memo, t.order_id, t.created_at FROM ledger_entries e
       JOIN ledger_accounts a ON a.id = e.account_id JOIN ledger_transactions t ON t.id = e.transaction_id
       WHERE a.code = $1 AND ($2::bigint IS NULL OR e.id < $2) ORDER BY e.id DESC LIMIT $3`, [acct.seller(user.id, currency), c?.id ?? null, q.limit + 1]);
    const page = rows.slice(0, q.limit);
    return { data: page.map((r) => ({ id: r.id, kind: r.kind, amount: r.direction === "credit" ? r.amount : `-${r.amount}`, memo: r.memo, orderId: r.order_id, at: r.created_at.toISOString() })),
      nextCursor: rows.length > q.limit ? cursor.encode({ id: page[page.length - 1]!.id }) : null };
  }

  async payoutAccounts(user: AuthUser) {
    return (await this.sql.many<{ id: string; type: string; provider: string; label: string; network: string | null; is_default: boolean }>(`SELECT id, type, provider, label, network, is_default FROM payout_accounts WHERE user_id = $1 ORDER BY created_at`, [user.id]))
      .map((a) => ({ id: a.id, type: a.type, provider: a.provider, label: a.label, network: a.network, isDefault: a.is_default }));
  }

  async addPayoutAccount(user: AuthUser, d: { type: "momo" | "bank"; provider: string; network?: Network; bankCode?: string; accountNumber: string; accountName: string; isDefault?: boolean }) {
    if (d.type === "momo" && !d.network) throw AppError.unprocessable("network_required", "Choose the mobile money network");
    if (d.type === "bank" && !d.bankCode) throw AppError.unprocessable("bank_required", "Choose the bank");
    const { currency } = await this.limits(user.country);
    const r = await psp(d.provider).createRecipient({ type: d.type, network: d.network, bankCode: d.bankCode, accountNumber: d.accountNumber, accountName: d.accountName, currency });
    const first = !(await this.sql.one(`SELECT 1 FROM payout_accounts WHERE user_id = $1`, [user.id]));
    const row = await this.sql.tx(async (c) => {
      if (d.isDefault || first) await c.query(`UPDATE payout_accounts SET is_default = false WHERE user_id = $1`, [user.id]);
      return (await c.query<{ id: string }>(`INSERT INTO payout_accounts (user_id, type, provider, recipient_code, label, network, is_default) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [user.id, d.type, d.provider, r.recipientCode, r.label, d.network ?? null, Boolean(d.isDefault || first)])).rows[0]!;
    });
    await this.audit.record({ actorId: user.id, action: "payout_account.added", entity: "payout_account", entityId: row.id });
    return (await this.payoutAccounts(user)).find((a) => a.id === row.id);
  }

  private payoutDto(p: Record<string, any>) {
    return { id: p.id, amount: p.amount, currency: p.currency, status: p.status, accountId: p.account_id, failureReason: p.failure_reason, createdAt: p.created_at.toISOString() };
  }
  async payouts(user: AuthUser) {
    return (await this.sql.many(`SELECT * FROM payouts WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 100`, [user.id])).map((p) => this.payoutDto(p));
  }

  /** Reserves funds immediately (ledger debit), then the scheduler executes the PSP transfer, or holds it for review above the threshold. */
  async requestPayout(user: AuthUser, d: { amount: string; accountId?: string }, idem?: string) {
    const { currency, limits } = await this.limits(user.country);
    const acc = await this.sql.one<{ id: string; provider: string }>(
      d.accountId ? `SELECT id, provider FROM payout_accounts WHERE id = $2 AND user_id = $1` : `SELECT id, provider FROM payout_accounts WHERE user_id = $1 AND is_default`, d.accountId ? [user.id, d.accountId] : [user.id]);
    if (!acc) throw AppError.unprocessable("payout_account_required", "Add a payout account first");
    const kyc = await this.sql.one<{ kyc_status: string }>(`SELECT kyc_status FROM seller_profiles WHERE user_id = $1`, [user.id]);
    if (kyc?.kyc_status !== "verified") throw AppError.forbidden("kyc_required", "Verify your identity before withdrawing");

    return this.sql.tx(async (c) => {
      // Serialise payouts per seller so two concurrent requests can't overdraw.
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`payout:${user.id}`]);
      const avail = (await c.query<{ balance: string }>(`SELECT balance::text FROM ledger_balances WHERE code = $1`, [acct.seller(user.id, currency)])).rows[0]?.balance ?? "0";
      const dec = payoutDecision(d.amount, avail, limits);
      if (!dec.ok) throw AppError.unprocessable(dec.code, dec.code === "insufficient_balance" ? `Available balance is ${currency} ${avail}` : `Payouts must be between ${limits.min} and ${limits.max}`);
      const id = randomUUID();
      const p = (await c.query(`INSERT INTO payouts (id, seller_id, account_id, amount, currency, status, provider) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [id, user.id, acc.id, new Decimal(d.amount).toFixed(2), currency, dec.needsReview ? "pending_review" : "approved", acc.provider])).rows[0];
      await this.ledger.post("payout", `payout:${id}`, payout(user.id, acc.provider, currency, d.amount), { payoutId: id }, c);
      if (!dec.needsReview) await this.queue.raw("commerce", "payout-execute", { payoutId: id }, `payout_${id}`);
      await this.audit.record({ actorId: user.id, action: "payout.requested", entity: "payout", entityId: id, data: { amount: d.amount, review: dec.needsReview } });
      return this.payoutDto(p);
    });
  }

  async executePayout(payoutId: string) {
    const p = await this.sql.one<{ id: string; status: string; amount: string; currency: string; provider: string; recipient_code: string; seller_id: string }>(
      `SELECT p.id, p.status, p.amount::text, p.currency, p.provider, a.recipient_code, p.seller_id FROM payouts p JOIN payout_accounts a ON a.id = p.account_id WHERE p.id = $1`, [payoutId]);
    if (!p || p.status !== "approved") return;
    await this.sql.exec(`UPDATE payouts SET status = 'processing' WHERE id = $1`, [p.id]);
    try {
      const r = await psp(p.provider).transfer(p.recipient_code, p.amount, p.currency, poRef(p.id), "AgriPrice payout");
      await this.sql.exec(`UPDATE payouts SET provider_ref = $2 WHERE id = $1`, [p.id, r.providerRef]);
      if (r.status !== "pending") await this.payoutResult(poRef(p.id), r.status);
    } catch (e) {
      if (e instanceof AppError) await this.payoutResult(poRef(p.id), "failed", (e.detail ?? e.code).slice(0, 300));
      else { await this.sql.exec(`UPDATE payouts SET status = 'approved' WHERE id = $1`, [p.id]); throw e; } // transient → retry
    }
  }

  private async payoutResult(reference: string, status: string, reason?: string) {
    const prefix = reference.replace(/^po_?/, "");
    if (!/^[0-9a-f]{30}$/.test(prefix)) return;
    const p = await this.sql.one<{ id: string; status: string; seller_id: string; provider: string; currency: string; amount: string }>(
      `SELECT id, status, seller_id, provider, currency, amount::text FROM payouts WHERE replace(id::text, '-', '') LIKE $1 || '%'`, [prefix]);
    if (!p || ["paid", "failed", "rejected"].includes(p.status)) return;
    if (status === "succeeded") {
      await this.sql.exec(`UPDATE payouts SET status = 'paid' WHERE id = $1`, [p.id]);
      await this.queue.dispatch({ userId: p.seller_id, category: "system", templateKey: "payout.paid", params: { title: "Payout sent", body: `${p.currency} ${p.amount} has been sent to your account.` }, dedupeKey: `payout_paid:${p.id}` });
    } else if (status === "failed") {
      await this.sql.exec(`UPDATE payouts SET status = 'failed', failure_reason = $2 WHERE id = $1`, [p.id, reason ?? "provider_failed"]);
      await this.ledger.post("payout_reversal", `payout_reversal:${p.id}`, payoutReversal(p.seller_id, p.provider, p.currency, p.amount), { payoutId: p.id });
      await this.queue.dispatch({ userId: p.seller_id, category: "system", templateKey: "payout.failed", params: { title: "Payout failed", body: `Your payout of ${p.currency} ${p.amount} failed and the money is back in your balance.` }, dedupeKey: `payout_failed:${p.id}` });
    }
  }

  async reviewPayout(admin: AuthUser, id: string, d: { action: "approve" | "reject"; reason?: string }) {
    const p = await this.sql.one<{ id: string; status: string; seller_id: string; provider: string; currency: string; amount: string }>(`SELECT id, status, seller_id, provider, currency, amount::text FROM payouts WHERE id = $1`, [id]);
    if (!p || p.status !== "pending_review") throw AppError.notFound("payout_pending_review");
    if (p.seller_id === admin.id) throw AppError.forbidden("self_review", "You can't review your own payout");
    if (d.action === "approve") {
      await this.sql.exec(`UPDATE payouts SET status = 'approved', reviewed_by = $2, review_note = $3 WHERE id = $1`, [id, admin.id, d.reason ?? null]);
      await this.queue.raw("commerce", "payout-execute", { payoutId: id }, `payout_${id}`);
    } else {
      await this.sql.exec(`UPDATE payouts SET status = 'rejected', reviewed_by = $2, review_note = $3 WHERE id = $1`, [id, admin.id, d.reason ?? null]);
      await this.ledger.post("payout_reversal", `payout_reversal:${id}`, payoutReversal(p.seller_id, p.provider, p.currency, p.amount), { payoutId: id, memo: "rejected in review" });
    }
    await this.audit.record({ actorId: admin.id, action: `payout.review.${d.action}`, entity: "payout", entityId: id, data: { reason: d.reason } });
    return this.payoutDto((await this.sql.one(`SELECT * FROM payouts WHERE id = $1`, [id]))!);
  }

  /** Scheduler job: refund through the PSP (or a MoMo transfer for Hubtel, which has no refund API). */
  async executeRefund(j: { orderId: string; paymentId: string; amount: string }) {
    const p = await this.sql.one<{ id: string; provider: string; provider_ref: string | null; currency: string; payer_msisdn_enc: string | null; network: string | null; refunded: string; amount: string }>(
      `SELECT id, provider, provider_ref, currency, payer_msisdn_enc, network, refunded::text, amount::text FROM payments WHERE id = $1`, [j.paymentId]);
    if (!p) return;
    if (new Decimal(p.refunded).plus(j.amount).gt(p.amount)) return; // already refunded
    if (p.provider === "hubtel") {
      if (!p.payer_msisdn_enc || !p.network) throw new Error("hubtel refund needs payer msisdn");
      const adapter = psp("hubtel");
      const rc = await adapter.createRecipient({ type: "momo", network: p.network as Network, accountNumber: this.cipher.decrypt(p.payer_msisdn_enc).replace(/^\+/, ""), accountName: "Refund", currency: p.currency });
      await adapter.transfer(rc.recipientCode, j.amount, p.currency, `rf${p.id.replace(/-/g, "").slice(0, 30)}`, "AgriPrice refund");
    } else {
      await psp(p.provider).refund(p.provider_ref!, j.amount, p.currency);
    }
    await this.sql.exec(`UPDATE payments SET refunded = refunded + $2, status = CASE WHEN refunded + $2 >= amount THEN 'refunded' ELSE 'partially_refunded' END WHERE id = $1`, [p.id, j.amount]);
    await this.audit.record({ actorId: null, action: "payment.refunded", entity: "payment", entityId: p.id, data: { amount: j.amount, orderId: j.orderId } });
  }

  // ── disputes ──
  async dispute(user: AuthUser, id: string) {
    const d = await this.sql.one<{ id: string; order_id: string; reason: string; description: string; status: string; resolution: unknown; created_at: Date; buyer_id: string; seller_id: string }>(
      `SELECT d.*, o.buyer_id, o.seller_id FROM disputes d JOIN orders o ON o.id = d.order_id WHERE d.id = $1`, [id]);
    if (!d || (user.role !== "admin" && ![d.buyer_id, d.seller_id].includes(user.id))) throw AppError.notFound("dispute");
    const ev = await this.sql.many<{ id: string; uploaded_by: string; object_key: string | null; note: string | null; created_at: Date }>(`SELECT * FROM dispute_evidence WHERE dispute_id = $1 ORDER BY created_at`, [id]);
    return {
      id: d.id, orderId: d.order_id, reason: d.reason, description: d.description, status: d.status, resolution: d.resolution, createdAt: d.created_at.toISOString(),
      evidence: await Promise.all(ev.map(async (e) => ({ id: e.id, uploadedBy: e.uploaded_by, note: e.note, createdAt: e.created_at.toISOString(),
        url: e.object_key ? await this.storage.signedGetUrl(this.storage.cfg.s3.reportsBucket, e.object_key, 3600) : null }))),
    };
  }

  async addEvidence(user: AuthUser, id: string, file: Express.Multer.File | undefined, note?: string) {
    const d = await this.dispute(user, id);
    if (d.status === "resolved") throw AppError.unprocessable("dispute_resolved", "This dispute is closed");
    if (!file && !note) throw AppError.unprocessable("evidence_required", "Attach a file or write a note");
    let key: string | null = null;
    if (file) {
      if (file.size > 15 * 1024 * 1024) throw AppError.unprocessable("file_too_large", "Max 15 MB");
      if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.mimetype)) throw AppError.unprocessable("file_type", "Images or PDF only");
      key = `disputes/${id}/${randomUUID()}`;
      await this.storage.put(this.storage.cfg.s3.reportsBucket, key, file.buffer, file.mimetype);
    }
    await this.sql.exec(`INSERT INTO dispute_evidence (dispute_id, uploaded_by, object_key, note) VALUES ($1,$2,$3,$4)`, [id, user.id, key, note ?? null]);
    await this.sql.exec(`UPDATE disputes SET status = 'under_review' WHERE id = $1 AND status = 'open'`, [id]);
    return this.dispute(user, id);
  }

  async decideDispute(admin: AuthUser, id: string, d: { outcome: "release_seller" | "refund_buyer" | "split"; refundAmount?: string; note?: string }) {
    const dis = await this.sql.one<{ order_id: string; status: string; buyer_id: string; seller_id: string }>(`SELECT d.order_id, d.status, o.buyer_id, o.seller_id FROM disputes d JOIN orders o ON o.id = d.order_id WHERE d.id = $1`, [id]);
    if (!dis || dis.status === "resolved") throw AppError.notFound("open_dispute");
    if ([dis.buyer_id, dis.seller_id].includes(admin.id)) throw AppError.forbidden("conflict_of_interest");
    const action = d.outcome === "release_seller" ? "resolve_release" : d.outcome === "refund_buyer" ? "resolve_refund" : "resolve_split";
    await this.orders.apply(dis.order_id, action, { userId: admin.id, role: "admin" }, { reason: d.note, refundAmount: d.refundAmount });
    await this.sql.exec(`UPDATE disputes SET status = 'resolved', resolution = $2, decided_by = $3, decided_at = now() WHERE id = $1`, [id, JSON.stringify(d), admin.id]);
    return this.orders.get(admin, dis.order_id);
  }

  /** Daily reconciliation: every succeeded payment for the day must appear in the PSP's settled list, and vice versa. */
  async reconcile(provider: string, day: string) {
    const ours = await this.sql.many<{ reference: string; amount: string; currency: string }>(
      `SELECT reference, amount::text, currency FROM payments WHERE provider = $1 AND status IN ('succeeded','refunded','partially_refunded') AND updated_at::date = $2::date`, [provider, day]);
    let theirs: { reference: string; amount: string; currency: string }[];
    try { theirs = await psp(provider).settlements(day); } catch (e) {
      await this.sql.exec(`INSERT INTO reconciliation_runs (provider, day, status, details) VALUES ($1,$2,'failed',$3) ON CONFLICT (provider, day) DO UPDATE SET status = 'failed', details = EXCLUDED.details`,
        [provider, day, JSON.stringify([{ error: (e as Error).message }])]);
      return;
    }
    const map = new Map(theirs.map((t) => [t.reference, t]));
    const issues: Record<string, unknown>[] = [];
    let matched = 0;
    for (const o of ours) {
      const t = map.get(o.reference);
      if (!t) issues.push({ reference: o.reference, issue: "missing_at_psp" });
      else if (!new Decimal(t.amount).eq(o.amount) || t.currency !== o.currency) issues.push({ reference: o.reference, issue: "amount_mismatch", ours: o.amount, theirs: t.amount });
      else matched++;
      map.delete(o.reference);
    }
    for (const t of map.values()) if (t.reference.startsWith("pay_")) issues.push({ reference: t.reference, issue: "missing_in_ledger", amount: t.amount });
    await this.sql.exec(
      `INSERT INTO reconciliation_runs (provider, day, status, matched, mismatched, details) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (provider, day) DO UPDATE SET status = EXCLUDED.status, matched = EXCLUDED.matched, mismatched = EXCLUDED.mismatched, details = EXCLUDED.details, created_at = now()`,
      [provider, day, issues.length ? "mismatched" : "matched", matched, issues.length, JSON.stringify(issues.slice(0, 500))]);
    if (issues.length) await this.audit.record({ actorId: null, action: "reconciliation.mismatch", data: { provider, day, count: issues.length } });
  }
}
