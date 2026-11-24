/**
 * Payment service provider adapters. Funds are collected into and paid out of the PSP's
 * licensed settlement account; we only hold tokens and references.
 */
import { AppError } from "../../common/http/problem";

export type Network = "mtn" | "telecel" | "airteltigo";
export interface CollectInput {
  reference: string; amount: string; currency: string; email: string | null; method: "momo" | "card";
  msisdn?: string; network?: Network; token?: string; callbackUrl?: string; metadata: Record<string, string>;
}
export interface CollectResult { status: "pending" | "succeeded" | "failed"; providerRef: string | null; authorizationUrl: string | null; displayText: string | null }
export interface VerifyResult { status: "pending" | "succeeded" | "failed"; amount: string; currency: string; providerRef: string; token?: { value: string; label: string; type: "card" | "momo" } | null }
export interface RecipientInput { type: "momo" | "bank"; network?: Network; bankCode?: string; accountNumber: string; accountName: string; currency: string }
export interface TransferResult { status: "pending" | "succeeded" | "failed"; providerRef: string | null }

export interface PspAdapter {
  name: "paystack" | "flutterwave" | "hubtel";
  collect(i: CollectInput): Promise<CollectResult>;
  verify(reference: string): Promise<VerifyResult>;
  refund(providerRef: string, amount: string, currency: string): Promise<{ providerRef: string | null }>;
  createRecipient(i: RecipientInput): Promise<{ recipientCode: string; label: string }>;
  transfer(recipientCode: string, amount: string, currency: string, reference: string, reason: string): Promise<TransferResult>;
  /** Settled transactions for a day, for reconciliation. */
  settlements(day: string): Promise<{ reference: string; amount: string; currency: string; status: string }[]>;
}

const minor = (amount: string) => Math.round(Number(amount) * 100);
const mask = (n: string) => `•••• ${n.slice(-3)}`;

async function call(base: string, secret: string | undefined, path: string, method = "GET", body?: unknown, extraHeaders: Record<string, string> = {}): Promise<any> {
  if (!secret) throw new AppError(503, "provider_unconfigured", "Service unavailable", "Payment provider is not configured");
  const res = await fetch(`${base}${path}`, {
    method, headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as { status?: unknown; message?: string };
  if (res.status >= 500) throw new Error(`psp ${res.status}`);
  if (!res.ok || j.status === false || j.status === "error") throw new AppError(502, "psp_error", "Bad gateway", j.message ?? `Provider returned ${res.status}`);
  return j;
}

// ── Paystack (GH: card, MTN/Telecel/AirtelTigo mobile money) ──
const PAYSTACK_NET: Record<Network, string> = { mtn: "mtn", telecel: "vod", airteltigo: "atl" };
export class PaystackAdapter implements PspAdapter {
  name = "paystack" as const;
  private base = "https://api.paystack.co";
  private get key() { return process.env.PAYSTACK_SECRET_KEY; }

  async collect(i: CollectInput): Promise<CollectResult> {
    const email = i.email ?? `${i.metadata.userId}@users.agriprice.app`;
    if (i.token) {
      const r = await call(this.base, this.key, "/transaction/charge_authorization", "POST", { authorization_code: i.token, email, amount: minor(i.amount), currency: i.currency, reference: i.reference, metadata: i.metadata });
      return { status: r.data.status === "success" ? "succeeded" : "pending", providerRef: String(r.data.id ?? ""), authorizationUrl: null, displayText: null };
    }
    if (i.method === "momo") {
      const r = await call(this.base, this.key, "/charge", "POST", {
        email, amount: minor(i.amount), currency: i.currency, reference: i.reference, metadata: i.metadata,
        mobile_money: { phone: i.msisdn!.replace(/^\+233/, "0"), provider: PAYSTACK_NET[i.network!] },
      });
      return { status: r.data.status === "success" ? "succeeded" : r.data.status === "failed" ? "failed" : "pending", providerRef: String(r.data.id ?? ""),
        authorizationUrl: null, displayText: r.data.display_text ?? "Approve the payment prompt on your phone" };
    }
    const r = await call(this.base, this.key, "/transaction/initialize", "POST", { email, amount: minor(i.amount), currency: i.currency, reference: i.reference, callback_url: i.callbackUrl, metadata: i.metadata, channels: ["card"] });
    return { status: "pending", providerRef: null, authorizationUrl: r.data.authorization_url, displayText: null };
  }
  async verify(reference: string): Promise<VerifyResult> {
    const r = await call(this.base, this.key, `/transaction/verify/${encodeURIComponent(reference)}`);
    const d = r.data; const a = d.authorization;
    return {
      status: d.status === "success" ? "succeeded" : ["failed", "abandoned", "reversed"].includes(d.status) ? "failed" : "pending",
      amount: (d.amount / 100).toFixed(2), currency: d.currency, providerRef: String(d.id),
      token: a?.reusable && a.authorization_code ? { value: a.authorization_code, type: a.channel === "mobile_money" ? "momo" : "card",
        label: a.channel === "mobile_money" ? `${(a.bank ?? "MoMo").toUpperCase()} ${mask(a.last4 ?? "")}` : `${(a.card_type ?? "card").toUpperCase()} •••• ${a.last4}` } : null,
    };
  }
  async refund(providerRef: string, amount: string) {
    const r = await call(this.base, this.key, "/refund", "POST", { transaction: providerRef, amount: minor(amount) });
    return { providerRef: String(r.data?.id ?? "") || null };
  }
  async createRecipient(i: RecipientInput) {
    const r = await call(this.base, this.key, "/transferrecipient", "POST", i.type === "momo"
      ? { type: "mobile_money", name: i.accountName, account_number: i.accountNumber, bank_code: { mtn: "MTN", telecel: "VOD", airteltigo: "ATL" }[i.network!], currency: i.currency }
      : { type: "ghipss", name: i.accountName, account_number: i.accountNumber, bank_code: i.bankCode, currency: i.currency });
    return { recipientCode: r.data.recipient_code, label: `${i.type === "momo" ? i.network!.toUpperCase() : r.data.details?.bank_name ?? "Bank"} ${mask(i.accountNumber)}` };
  }
  async transfer(recipientCode: string, amount: string, _currency: string, reference: string, reason: string): Promise<TransferResult> {
    const r = await call(this.base, this.key, "/transfer", "POST", { source: "balance", amount: minor(amount), recipient: recipientCode, reference, reason });
    return { status: r.data.status === "success" ? "succeeded" : r.data.status === "failed" ? "failed" : "pending", providerRef: r.data.transfer_code ?? null };
  }
  async settlements(day: string) {
    const r = await call(this.base, this.key, `/transaction?status=success&from=${day}T00:00:00Z&to=${day}T23:59:59Z&perPage=500`);
    return (r.data as any[]).map((t) => ({ reference: t.reference, amount: (t.amount / 100).toFixed(2), currency: t.currency, status: t.status }));
  }
}

// ── Flutterwave (mobile_money_ghana, card) ──
const FLW_NET: Record<Network, string> = { mtn: "MTN", telecel: "VODAFONE", airteltigo: "AIRTEL" };
export class FlutterwaveAdapter implements PspAdapter {
  name = "flutterwave" as const;
  private base = "https://api.flutterwave.com/v3";
  private get key() { return process.env.FLUTTERWAVE_SECRET_KEY; }

  async collect(i: CollectInput): Promise<CollectResult> {
    if (i.method === "momo") {
      const r = await call(this.base, this.key, "/charges?type=mobile_money_ghana", "POST", {
        tx_ref: i.reference, amount: i.amount, currency: i.currency, network: FLW_NET[i.network!], phone_number: i.msisdn!.replace(/^\+/, ""),
        email: i.email ?? `${i.metadata.userId}@users.agriprice.app`, meta: i.metadata,
      });
      return { status: "pending", providerRef: r.data?.id ? String(r.data.id) : null, authorizationUrl: r.meta?.authorization?.redirect ?? null, displayText: "Approve the payment prompt on your phone" };
    }
    const r = await call(this.base, this.key, "/payments", "POST", {
      tx_ref: i.reference, amount: i.amount, currency: i.currency, redirect_url: i.callbackUrl, payment_options: "card", meta: i.metadata,
      customer: { email: i.email ?? `${i.metadata.userId}@users.agriprice.app` },
    });
    return { status: "pending", providerRef: null, authorizationUrl: r.data.link, displayText: null };
  }
  async verify(reference: string): Promise<VerifyResult> {
    const r = await call(this.base, this.key, `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`);
    const d = r.data;
    return { status: d.status === "successful" ? "succeeded" : d.status === "failed" ? "failed" : "pending", amount: Number(d.amount).toFixed(2), currency: d.currency, providerRef: String(d.id),
      token: d.card?.token ? { value: d.card.token, type: "card", label: `${d.card.type ?? "CARD"} •••• ${d.card.last_4digits}` } : null };
  }
  async refund(providerRef: string, amount: string) {
    const r = await call(this.base, this.key, `/transactions/${providerRef}/refund`, "POST", { amount });
    return { providerRef: r.data?.id ? String(r.data.id) : null };
  }
  async createRecipient(i: RecipientInput) {
    // Flutterwave transfers take account details at transfer time; we store an opaque encoded beneficiary.
    const r = await call(this.base, this.key, "/beneficiaries", "POST", {
      account_number: i.accountNumber, account_bank: i.type === "momo" ? FLW_NET[i.network!] : i.bankCode, beneficiary_name: i.accountName, currency: i.currency,
    });
    return { recipientCode: String(r.data.id), label: `${i.type === "momo" ? i.network!.toUpperCase() : r.data.bank_name ?? "Bank"} ${mask(i.accountNumber)}` };
  }
  async transfer(recipientCode: string, amount: string, currency: string, reference: string, reason: string): Promise<TransferResult> {
    const r = await call(this.base, this.key, "/transfers", "POST", { beneficiary: Number(recipientCode), amount, currency, reference, narration: reason, debit_currency: currency });
    return { status: r.data.status === "SUCCESSFUL" ? "succeeded" : r.data.status === "FAILED" ? "failed" : "pending", providerRef: r.data?.id ? String(r.data.id) : null };
  }
  async settlements(day: string) {
    const r = await call(this.base, this.key, `/transactions?from=${day}&to=${day}&status=successful`);
    return (r.data as any[]).map((t) => ({ reference: t.tx_ref, amount: Number(t.amount).toFixed(2), currency: t.currency, status: t.status }));
  }
}

// ── Hubtel (Ghana: Receive Money / Send Money) ──
const HUBTEL_CHANNEL: Record<Network, string> = { mtn: "mtn-gh", telecel: "vodafone-gh", airteltigo: "tigo-gh" };
export class HubtelAdapter implements PspAdapter {
  name = "hubtel" as const;
  private get auth() {
    const id = process.env.HUBTEL_CLIENT_ID, secret = process.env.HUBTEL_CLIENT_SECRET;
    if (!id || !secret) throw new AppError(503, "provider_unconfigured", "Service unavailable", "Hubtel is not configured");
    return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
  }
  private get pos() { return process.env.HUBTEL_POS_ID ?? ""; }
  private async req(url: string, method: string, body?: unknown) {
    const res = await fetch(url, { method, headers: { Authorization: this.auth, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
    const j = (await res.json().catch(() => ({}))) as any;
    if (res.status >= 500) throw new Error(`hubtel ${res.status}`);
    if (!res.ok || (j.ResponseCode && !["0000", "0001"].includes(j.ResponseCode))) throw new AppError(502, "psp_error", "Bad gateway", j.Message ?? j.message ?? `Hubtel ${res.status}`);
    return j;
  }
  async collect(i: CollectInput): Promise<CollectResult> {
    if (i.method !== "momo") throw AppError.unprocessable("method_unsupported", "Hubtel is used for mobile money only");
    const j = await this.req(`https://rmp.hubtel.com/merchantaccount/merchants/${this.pos}/receive/mobilemoney`, "POST", {
      CustomerMsisdn: i.msisdn!.replace(/^\+/, ""), Channel: HUBTEL_CHANNEL[i.network!], Amount: Number(i.amount), PrimaryCallbackUrl: i.callbackUrl,
      Description: "AgriPrice order", ClientReference: i.reference,
    });
    return { status: "pending", providerRef: j.Data?.TransactionId ?? null, authorizationUrl: null, displayText: "Approve the payment prompt on your phone" };
  }
  async verify(reference: string): Promise<VerifyResult> {
    const j = await this.req(`https://api-txnstatus.hubtel.com/transactions/${this.pos}/status?clientReference=${encodeURIComponent(reference)}`, "GET");
    const d = j.data ?? j.Data ?? {};
    const st = String(d.status ?? d.Status ?? "").toLowerCase();
    return { status: st === "paid" || st === "success" ? "succeeded" : st === "unpaid" || st === "failed" ? "failed" : "pending",
      amount: Number(d.amount ?? d.Amount ?? 0).toFixed(2), currency: "GHS", providerRef: String(d.transactionId ?? d.TransactionId ?? ""), token: null };
  }
  async refund(): Promise<{ providerRef: string | null }> {
    // Hubtel has no refund API for MoMo collections: refunds are executed as a Send Money transfer by the payout job.
    return { providerRef: null };
  }
  async createRecipient(i: RecipientInput) {
    if (i.type !== "momo") throw AppError.unprocessable("method_unsupported", "Hubtel payouts support mobile money only");
    return { recipientCode: `${HUBTEL_CHANNEL[i.network!]}:${i.accountNumber}`, label: `${i.network!.toUpperCase()} ${mask(i.accountNumber)}` };
  }
  async transfer(recipientCode: string, amount: string, _c: string, reference: string, reason: string): Promise<TransferResult> {
    const [channel, msisdn] = recipientCode.split(":");
    const j = await this.req(`https://smp.hubtel.com/api/merchants/${process.env.HUBTEL_PREPAID_ID ?? this.pos}/send/mobilemoney`, "POST", {
      RecipientMsisdn: msisdn, Channel: channel, Amount: Number(amount), Description: reason, ClientReference: reference,
      PrimaryCallbackUrl: `${process.env.API_PUBLIC_URL}/v1/webhooks/payments/hubtel?token=${process.env.WEBHOOK_SHARED_SECRET}`,
    });
    return { status: "pending", providerRef: j.Data?.TransactionId ?? null };
  }
  async settlements(): Promise<{ reference: string; amount: string; currency: string; status: string }[]> {
    // Hubtel settlement reports are downloaded from the merchant portal (SFTP). See pipelines for the importer.
    return [];
  }
}

export const PSPS: Record<string, PspAdapter> = { paystack: new PaystackAdapter(), flutterwave: new FlutterwaveAdapter(), hubtel: new HubtelAdapter() };
export function psp(name: string): PspAdapter {
  const a = PSPS[name];
  if (!a) throw AppError.unprocessable("provider_unsupported", name);
  return a;
}
