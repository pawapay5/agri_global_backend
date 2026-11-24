import type { Queue } from "bullmq";
import type { Pool } from "pg";
import type { Logger } from "pino";
import { quietHoursDelayMs, render } from "../alert.logic";
import { Channel, PermanentError, Provider } from "../providers/providers";

export interface DispatchJob {
  userId: string;
  category: string;
  templateKey: string;
  params: Record<string, string | number>;
  data?: Record<string, unknown>;
  channels?: string[];
  dedupeKey?: string;
}
export interface DeliverJob { deliveryId: string }
export interface SendOtpJob { channel: "sms" | "email"; destination: string; code: string; purpose: string; locale: string }

const DEFAULTS: Record<string, string[]> = {
  price_alert: ["push", "in_app"], market_update: ["in_app"], weather: ["push", "in_app"], system: ["email", "in_app"], weekly_insight: ["email", "in_app"],
};

interface Template { subject: string | null; body: string; provider_template: string | null; locale: string }

export class Dispatcher {
  constructor(private db: Pool, private providers: Partial<Record<Channel, Provider>>, private deliverQueue: Queue, private log: Logger) {}

  /** Locale fallback: exact → language → en. */
  async template(key: string, channel: string, locale: string): Promise<Template | null> {
    const lang = locale.split("-")[0]!;
    const r = await this.db.query<Template>(
      `SELECT subject, body, provider_template, locale FROM notification_templates WHERE key = $1 AND channel = $2 AND locale = ANY($3)
       ORDER BY array_position($3, locale) LIMIT 1`, [key, channel, [locale, lang, "en"]]);
    return r.rows[0] ?? null;
  }

  /** Writes the in-app notification (idempotent on dedupeKey) and queues each external delivery. */
  async dispatch(j: DispatchJob): Promise<void> {
    const u = (await this.db.query<{ email: string | null; phone: string | null; locale: string | null; country_locale: string; deleted: boolean; categories: Record<string, string[]> | null;
      quiet_start: string | null; quiet_end: string | null; tz: string; whatsapp: string | null; sms_ok: boolean | null; wa_ok: boolean | null }>(
      `SELECT u.email, u.phone, p.locale, c.default_locale AS country_locale, u.deletion_scheduled_at IS NOT NULL AS deleted,
              np.categories, to_char(np.quiet_start, 'HH24:MI') AS quiet_start, to_char(np.quiet_end, 'HH24:MI') AS quiet_end,
              coalesce(np.timezone, c.timezone) AS tz, np.whatsapp_number AS whatsapp,
              (SELECT granted FROM consents WHERE user_id = u.id AND type = 'sms_alerts' ORDER BY created_at DESC LIMIT 1) AS sms_ok,
              (SELECT granted FROM consents WHERE user_id = u.id AND type = 'whatsapp_alerts' ORDER BY created_at DESC LIMIT 1) AS wa_ok
       FROM users u JOIN countries c ON c.iso2 = u.country_iso2
       LEFT JOIN user_preferences p ON p.user_id = u.id LEFT JOIN notification_preferences np ON np.user_id = u.id
       WHERE u.id = $1`, [j.userId])).rows[0];
    if (!u || u.deleted) return;

    const locale = u.locale ?? u.country_locale;
    const wanted = new Set(j.channels?.length ? j.channels : (u.categories?.[j.category] ?? DEFAULTS[j.category] ?? ["in_app"]));
    // Category preferences can only narrow explicit channels (an alert asking for SMS still needs SMS enabled for price_alert).
    const allowed = new Set(u.categories?.[j.category] ?? DEFAULTS[j.category] ?? ["in_app"]);
    const channels = [...wanted].filter((c) => c === "in_app" || allowed.has(c) || j.channels?.includes(c));

    const inApp = await this.template(j.templateKey, "in_app", locale);
    const title = render(inApp?.subject ?? String(j.params.title ?? j.templateKey), j.params);
    const body = render(inApp?.body ?? String(j.params.body ?? ""), j.params);
    const n = await this.db.query<{ id: string }>(
      `INSERT INTO notifications (user_id, category, template_key, title, body, data, dedupe_key) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`, [j.userId, j.category, j.templateKey, title, body, j.data ?? {}, j.dedupeKey ?? null]);
    if (!n.rows[0]) { this.log.debug({ dedupeKey: j.dedupeKey }, "duplicate dispatch skipped"); return; }
    const notificationId = n.rows[0].id;

    const delay = quietHoursDelayMs(new Date(), u.quiet_start, u.quiet_end, u.tz);
    for (const ch of channels.filter((c) => c !== "in_app") as Channel[]) {
      const dest = ch === "email" ? u.email : ch === "sms" ? (u.sms_ok === false ? null : u.phone) : ch === "whatsapp" ? (u.wa_ok ? u.whatsapp ?? u.phone : null) : "device";
      const provider = this.providers[ch];
      const status = !dest || !provider ? "skipped" : "queued";
      const d = await this.db.query<{ id: string }>(
        `INSERT INTO notification_deliveries (notification_id, user_id, channel, provider, status, last_error) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (notification_id, channel) DO NOTHING RETURNING id`,
        [notificationId, j.userId, ch, provider?.name ?? "none", status, !dest ? "no_destination_or_consent" : !provider ? "provider_not_configured" : null]);
      // Push, SMS and WhatsApp wait out quiet hours. Email is not intrusive, so it goes now.
      if (status === "queued" && d.rows[0]) await this.deliverQueue.add("deliver", { deliveryId: d.rows[0].id }, { delay: ch === "email" ? 0 : delay, jobId: `deliver_${d.rows[0].id}` });
    }
  }

  /** Sends one delivery. Throws on transient errors so BullMQ retries with exponential backoff. */
  async deliver(j: DeliverJob, attemptsMade: number): Promise<void> {
    const d = (await this.db.query<{ id: string; channel: Channel; status: string; user_id: string; title: string; body: string; data: Record<string, unknown>; template_key: string | null; params: unknown }>(
      `SELECT d.id, d.channel, d.status, d.user_id, n.title, n.body, n.data, n.template_key, NULL AS params
       FROM notification_deliveries d JOIN notifications n ON n.id = d.notification_id WHERE d.id = $1`, [j.deliveryId])).rows[0];
    if (!d || !["queued", "failed"].includes(d.status)) return;
    const provider = this.providers[d.channel];
    if (!provider) return;

    const u = (await this.db.query<{ email: string | null; phone: string | null; whatsapp: string | null; locale: string }>(
      `SELECT u.email, u.phone, np.whatsapp_number AS whatsapp, coalesce(p.locale, c.default_locale) AS locale
       FROM users u JOIN countries c ON c.iso2 = u.country_iso2 LEFT JOIN user_preferences p ON p.user_id = u.id
       LEFT JOIN notification_preferences np ON np.user_id = u.id WHERE u.id = $1 AND u.deletion_scheduled_at IS NULL`, [d.user_id])).rows[0];
    if (!u) return this.mark(d.id, "skipped", "user_unavailable");

    const tpl = d.template_key ? await this.template(d.template_key, d.channel, u.locale) : null;
    const params = { title: d.title, body: d.body, ...(d.data as Record<string, string>) };
    const msg = { subject: tpl?.subject ? render(tpl.subject, params) : d.title, body: tpl ? render(tpl.body, params) : d.body, data: d.data, providerTemplate: tpl?.provider_template, locale: u.locale };

    let targets: string[] = [];
    if (d.channel === "push") targets = (await this.db.query<{ push_token: string }>(`SELECT push_token FROM devices WHERE user_id = $1 AND revoked_at IS NULL AND push_token IS NOT NULL`, [d.user_id])).rows.map((r) => r.push_token);
    else { const t = d.channel === "email" ? u.email : d.channel === "sms" ? u.phone : u.whatsapp ?? u.phone; if (t) targets = [t]; }
    if (!targets.length) return this.mark(d.id, "skipped", "no_destination");

    await this.db.query(`UPDATE notification_deliveries SET attempts = $2 WHERE id = $1`, [d.id, attemptsMade + 1]);
    let lastId: string | null = null; let sent = 0;
    for (const to of targets) {
      try {
        lastId = (await provider.send({ ...msg, to })).messageId; sent++;
      } catch (e) {
        if (e instanceof PermanentError) {
          if (d.channel === "push" && e.message.startsWith("token_invalid")) await this.db.query(`UPDATE devices SET push_token = NULL WHERE push_token = $1`, [to]);
          this.log.warn({ deliveryId: d.id, err: e.message }, "permanent delivery failure");
          continue;
        }
        await this.mark(d.id, "failed", (e as Error).message);
        throw e; // transient → retry
      }
    }
    if (sent) await this.db.query(`UPDATE notification_deliveries SET status = 'sent', provider = $2, provider_message_id = $3, sent_at = now(), last_error = NULL WHERE id = $1`, [d.id, provider.name, lastId]);
    else await this.mark(d.id, "failed", "all_targets_rejected");
  }

  private async mark(id: string, status: string, err: string) {
    await this.db.query(`UPDATE notification_deliveries SET status = $2, last_error = $3 WHERE id = $1`, [id, status, err.slice(0, 500)]);
  }

  /** Outbound SMS reply (two-way SMS / commands). */
  async sendSms(j: { to: string; body: string }): Promise<void> {
    const provider = this.providers.sms;
    if (!provider) throw new PermanentError("No sms provider configured");
    await provider.send({ to: j.to, body: j.body.slice(0, 459) });
  }

  async sendOtp(j: SendOtpJob): Promise<void> {
    const provider = this.providers[j.channel];
    if (!provider) throw new PermanentError(`No ${j.channel} provider configured`);
    const tpl = await this.template(`otp.${j.purpose}`, j.channel, j.locale) ?? await this.template("otp.login", j.channel, j.locale);
    const body = render(tpl?.body ?? "Your AgriPrice code is {{code}}. It expires in 10 minutes.", { code: j.code });
    await provider.send({ to: j.destination, subject: tpl?.subject ?? "Your AgriPrice code", body });
    // Never log the code or full destination.
    this.log.info({ channel: j.channel, purpose: j.purpose, to: j.destination.replace(/.(?=.{3})/g, "•") }, "otp sent");
  }
}
