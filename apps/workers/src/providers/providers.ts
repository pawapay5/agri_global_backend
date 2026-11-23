import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { importPKCS8, SignJWT } from "jose";
import nodemailer from "nodemailer";
import type { Logger } from "pino";

export type Channel = "push" | "email" | "sms" | "whatsapp";
export interface Message { to: string; subject?: string; body: string; data?: Record<string, unknown>; providerTemplate?: string | null; locale?: string }
export interface SendResult { provider: string; messageId: string | null }

/** Error that should NOT be retried (bad number, unregistered token, …). */
export class PermanentError extends Error {}

export interface Provider { name: string; channel: Channel; send(m: Message): Promise<SendResult> }

const env = process.env;

async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<any> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new PermanentError(`${res.status}: ${text.slice(0, 300)}`);
  if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 300)}`);
  return json;
}

// ── Push: FCM HTTP v1 ──
class FcmProvider implements Provider {
  name = "fcm"; channel = "push" as const;
  private token?: { value: string; exp: number };
  private sa = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON || "{}") as { client_email?: string; private_key?: string };

  private async accessToken(): Promise<string> {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const key = await importPKCS8(this.sa.private_key!, "RS256");
    const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuer(this.sa.client_email!).setAudience("https://oauth2.googleapis.com/token")
      .setIssuedAt().setExpirationTime("1h").sign(key);
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    });
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  async send(m: Message): Promise<SendResult> {
    const data = Object.fromEntries(Object.entries(m.data ?? {}).map(([k, v]) => [k, String(v)]));
    try {
      const j = await postJson(`https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`,
        { message: { token: m.to, notification: { title: m.subject, body: m.body }, data, android: { priority: "high" } } },
        { Authorization: `Bearer ${await this.accessToken()}` });
      return { provider: this.name, messageId: j.name ?? null };
    } catch (e) {
      if (e instanceof PermanentError && /UNREGISTERED|INVALID_ARGUMENT/.test(e.message)) throw new PermanentError(`token_invalid: ${e.message}`);
      throw e;
    }
  }
}

// ── SMS: Africa's Talking / Twilio / log ──
class AfricasTalkingProvider implements Provider {
  name = "africastalking"; channel = "sms" as const;
  async send(m: Message): Promise<SendResult> {
    const host = env.AT_USERNAME === "sandbox" ? "api.sandbox.africastalking.com" : "api.africastalking.com";
    const res = await fetch(`https://${host}/version1/messaging`, {
      method: "POST",
      headers: { apiKey: env.AT_API_KEY!, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: env.AT_USERNAME!, to: m.to, message: m.body, ...(env.AT_SENDER_ID ? { from: env.AT_SENDER_ID } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw res.status < 500 ? new PermanentError(`AT ${res.status}`) : new Error(`AT ${res.status}`);
    const j = (await res.json()) as { SMSMessageData?: { Recipients?: { messageId: string; status: string; statusCode: number }[] } };
    const r = j.SMSMessageData?.Recipients?.[0];
    if (!r || r.statusCode >= 400) throw new PermanentError(`AT rejected: ${r?.status ?? "no recipient"}`);
    return { provider: this.name, messageId: r.messageId };
  }
}

class TwilioProvider implements Provider {
  name = "twilio"; channel = "sms" as const;
  async send(m: Message): Promise<SendResult> {
    const sid = env.TWILIO_ACCOUNT_SID!;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: m.to, From: env.TWILIO_FROM!, Body: m.body, StatusCallback: `${env.API_PUBLIC_URL}/v1/webhooks/receipts/twilio` }),
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await res.json()) as { sid?: string; message?: string };
    if (res.status >= 400 && res.status < 500) throw new PermanentError(`twilio ${res.status}: ${j.message}`);
    if (!res.ok) throw new Error(`twilio ${res.status}`);
    return { provider: this.name, messageId: j.sid ?? null };
  }
}

class LogProvider implements Provider {
  constructor(public channel: Channel, private log: Logger) {}
  name = "log";
  async send(m: Message): Promise<SendResult> {
    // Development only: never enabled when NODE_ENV=production (see buildProviders).
    this.log.info({ channel: this.channel, to: m.to, subject: m.subject, body: m.body }, "DEV message (not sent)");
    return { provider: this.name, messageId: null };
  }
}

// ── Email: SES / Postmark / SMTP ──
class SesProvider implements Provider {
  name = "ses"; channel = "email" as const;
  private client = new SESv2Client({ region: env.AWS_SES_REGION });
  async send(m: Message): Promise<SendResult> {
    const r = await this.client.send(new SendEmailCommand({
      FromEmailAddress: env.EMAIL_FROM, Destination: { ToAddresses: [m.to] },
      Content: { Simple: { Subject: { Data: m.subject ?? "AgriPrice" }, Body: { Text: { Data: m.body } } } },
    }));
    return { provider: this.name, messageId: r.MessageId ?? null };
  }
}

class PostmarkProvider implements Provider {
  name = "postmark"; channel = "email" as const;
  async send(m: Message): Promise<SendResult> {
    const j = await postJson("https://api.postmarkapp.com/email",
      { From: env.EMAIL_FROM, To: m.to, Subject: m.subject ?? "AgriPrice", TextBody: m.body, MessageStream: "outbound" },
      { "X-Postmark-Server-Token": env.POSTMARK_TOKEN!, Accept: "application/json" });
    return { provider: this.name, messageId: j.MessageID ?? null };
  }
}

class SmtpProvider implements Provider {
  name = "smtp"; channel = "email" as const;
  private t = nodemailer.createTransport(env.SMTP_URL ?? "smtp://localhost:1025");
  async send(m: Message): Promise<SendResult> {
    const info = await this.t.sendMail({ from: env.EMAIL_FROM, to: m.to, subject: m.subject ?? "AgriPrice", text: m.body });
    return { provider: this.name, messageId: info.messageId ?? null };
  }
}

// ── WhatsApp Cloud API ──
class WhatsAppProvider implements Provider {
  name = "whatsapp"; channel = "whatsapp" as const;
  async send(m: Message): Promise<SendResult> {
    // Business-initiated messages must use an approved template. Free text is only allowed in the 24 h session window.
    const payload = m.providerTemplate
      ? { messaging_product: "whatsapp", to: m.to.replace("+", ""), type: "template",
          template: { name: m.providerTemplate, language: { code: m.locale ?? "en" }, components: [{ type: "body", parameters: [{ type: "text", text: m.body.slice(0, 1024) }] }] } }
      : { messaging_product: "whatsapp", to: m.to.replace("+", ""), type: "text", text: { body: m.body } };
    const j = await postJson(`https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, payload, { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` });
    return { provider: this.name, messageId: j.messages?.[0]?.id ?? null };
  }
}

export function buildProviders(log: Logger): Partial<Record<Channel, Provider>> {
  const prod = env.NODE_ENV === "production";
  const out: Partial<Record<Channel, Provider>> = {};
  if (env.FCM_PROJECT_ID && env.FCM_SERVICE_ACCOUNT_JSON) out.push = new FcmProvider();
  else if (!prod) out.push = new LogProvider("push", log);

  const sms = env.SMS_PROVIDER ?? "log";
  if (sms === "africastalking") out.sms = new AfricasTalkingProvider();
  else if (sms === "twilio") out.sms = new TwilioProvider();
  else if (!prod) out.sms = new LogProvider("sms", log);

  const email = env.EMAIL_PROVIDER ?? "smtp";
  out.email = email === "ses" ? new SesProvider() : email === "postmark" ? new PostmarkProvider() : new SmtpProvider();

  if (env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_TOKEN) out.whatsapp = new WhatsAppProvider();
  else if (!prod) out.whatsapp = new LogProvider("whatsapp", log);
  return out;
}
