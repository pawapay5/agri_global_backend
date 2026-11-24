import { createHmac } from "node:crypto";
import type { Request } from "express";
import { safeEqual } from "../crypto/crypto";
import { Sql } from "../db/database.module";
import { AppError } from "./problem";

export type RawRequest = Request & { rawBody?: Buffer };

/** Verifies provider webhook signatures. Secrets come from env; a missing secret always fails closed. */
export function verifyWebhook(provider: string, req: RawRequest): void {
  const env = process.env;
  const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
  const fail = (code = "signature_invalid") => { throw AppError.unauthorized(code); };
  switch (provider) {
    case "paystack": {
      const sig = req.header("x-paystack-signature"); const key = env.PAYSTACK_SECRET_KEY;
      if (!sig || !key) fail("signature_missing");
      if (!safeEqual(createHmac("sha512", key!).update(raw).digest("hex"), sig!)) fail();
      return;
    }
    case "flutterwave": {
      const sig = req.header("verif-hash"); const key = env.FLUTTERWAVE_WEBHOOK_HASH;
      if (!sig || !key || !safeEqual(sig, key)) fail();
      return;
    }
    case "stripe": {
      const header = req.header("stripe-signature"); const key = env.STRIPE_WEBHOOK_SECRET;
      if (!header || !key) fail("signature_missing");
      const parts = Object.fromEntries(header!.split(",").map((p) => p.split("=") as [string, string]));
      const t = Number(parts.t);
      if (!t || Math.abs(Date.now() / 1000 - t) > 300) fail("signature_expired");
      if (!parts.v1 || !safeEqual(createHmac("sha256", key!).update(`${t}.${raw.toString("utf8")}`).digest("hex"), parts.v1)) fail();
      return;
    }
    case "revenuecat": {
      const auth = req.header("authorization"); const key = env.REVENUECAT_WEBHOOK_AUTH;
      if (!auth || !key || !safeEqual(auth, `Bearer ${key}`)) fail();
      return;
    }
    case "hubtel": case "africastalking": case "kyc": {
      // These providers don't sign callbacks: use a secret URL token (plus an IP allow-list at the edge).
      const key = env.WEBHOOK_SHARED_SECRET; const got = (req.query.token as string | undefined) ?? req.header("x-webhook-token");
      if (!key || !got || !safeEqual(key, got)) fail();
      return;
    }
    case "twilio": {
      const token = env.TWILIO_AUTH_TOKEN; const sig = req.header("x-twilio-signature");
      if (!token || !sig) fail("signature_missing");
      const params = req.body as Record<string, string>;
      const data = `${env.API_PUBLIC_URL}${req.originalUrl}` + Object.keys(params).sort().map((k) => k + params[k]).join("");
      if (!safeEqual(createHmac("sha1", token!).update(data).digest("base64"), sig!)) fail();
      return;
    }
    default:
      throw AppError.notFound("provider");
  }
}

/** Records a webhook event once. Returns false if this (provider, eventId) was already received. */
export async function claimWebhookEvent(sql: Sql, provider: string, eventId: string, kind: string, type: string | null, payload: unknown): Promise<boolean> {
  const n = await sql.exec(
    `INSERT INTO webhook_events (provider, event_id, kind, type, payload) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [provider, eventId, kind, type, JSON.stringify(payload)]);
  return n > 0;
}

export async function markWebhookProcessed(sql: Sql, provider: string, eventId: string, error?: string) {
  await sql.exec(`UPDATE webhook_events SET processed_at = now(), error = $3 WHERE provider = $1 AND event_id = $2`, [provider, eventId, error ?? null]);
}
