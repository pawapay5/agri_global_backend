import { Controller, HttpCode, Injectable, Logger, Module, Param, Post, Req, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { Response } from "express";
import { Public } from "../../common/auth/auth.common";
import { hmac } from "../../common/crypto/crypto";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { RawRequest, verifyWebhook } from "../../common/http/webhooks";
import { I18nService } from "../../common/i18n/i18n.service";
import { D } from "../../common/money/money.math";
import { MoneyService } from "../../common/money/money.service";
import { QueueService } from "../../common/queue/queues";
import { Cache } from "../../common/redis/redis.module";
import { BillingService } from "../billing/billing.module";
import { fitSms, Keywords, mergeKeywords, NameEntry, parseCommand, resolveName, splitCommodityMarket } from "./sms.logic";

interface Sender { userId: string | null; country: string; locale: string; currency: string; unit: string }

@Injectable()
export class SmsService {
  private readonly log = new Logger(SmsService.name);
  constructor(private readonly sql: Sql, private readonly i18n: I18nService, private readonly money: MoneyService, private readonly cache: Cache,
    private readonly queue: QueueService, private readonly billing: BillingService) {}

  private async names(country: string) {
    return this.cache.wrap(`sms:names:${country}`, 600, async () => {
      const commodities = await this.sql.many<{ id: string; code: string; name: Record<string, string>; local: Record<string, string>; aliases: string[] }>(
        `SELECT c.id, c.code, c.name, p.local_names AS local, p.aliases FROM commodity_country_profiles p JOIN commodities c ON c.id = p.commodity_id WHERE p.country_iso2 = $1 AND p.tracked`, [country]);
      const markets = await this.sql.many<{ id: string; code: string; name: Record<string, string>; aliases: string[] }>(`SELECT id, code, name, aliases FROM markets WHERE country_iso2 = $1 AND active`, [country]);
      const kw = (await this.sql.one<{ k: Partial<Keywords> | null }>(`SELECT config->'sms_keywords' AS k FROM countries WHERE iso2 = $1`, [country]))?.k ?? undefined;
      const words = (s: string) => [s, s.split(" (")[0]!, s.split(" ")[0]!];
      return {
        commodities: commodities.map<NameEntry>((c) => ({ id: c.id, names: [...Object.values(c.name).flatMap(words), ...Object.values(c.local), ...c.aliases, c.code.replace(/_/g, " ")] })),
        markets: markets.map<NameEntry>((m) => ({ id: m.id, names: [...Object.values(m.name).flatMap(words), ...m.aliases, m.code.replace(/_/g, " ")] })),
        keywords: mergeKeywords(kw ?? undefined),
      };
    });
  }

  private async sender(phone: string): Promise<Sender> {
    const u = await this.sql.one<{ id: string; country_iso2: string; locale: string | null; currency: string | null; unit: string | null; c_locale: string; c_currency: string; c_unit: string }>(
      `SELECT u.id, u.country_iso2, p.locale, p.currency, p.unit, c.default_locale AS c_locale, c.currency AS c_currency, c.default_unit AS c_unit
       FROM users u JOIN countries c ON c.iso2 = u.country_iso2 LEFT JOIN user_preferences p ON p.user_id = u.id
       WHERE u.phone = $1 AND u.deletion_scheduled_at IS NULL`, [phone]);
    if (u) return { userId: u.id, country: u.country_iso2, locale: u.locale ?? u.c_locale, currency: u.currency ?? u.c_currency, unit: u.unit ?? u.c_unit };
    const c = await this.sql.one<{ iso2: string; default_locale: string; currency: string; default_unit: string }>(
      `SELECT iso2, default_locale, currency, default_unit FROM countries WHERE phone_prefix IS NOT NULL AND $1 LIKE phone_prefix || '%' AND active ORDER BY length(phone_prefix) DESC LIMIT 1`, [phone]);
    if (!c) throw AppError.unprocessable("country_unsupported", "Unsupported country");
    return { userId: null, country: c.iso2, locale: c.default_locale, currency: c.currency, unit: c.default_unit };
  }

  /** Phone-number accounts are created on first ALERT (sending the SMS is the opt-in). */
  private async ensureUser(phone: string, s: Sender): Promise<string> {
    if (s.userId) return s.userId;
    const r = await this.sql.one<{ id: string }>(
      `INSERT INTO users (phone, phone_verified_at, country_iso2, role) VALUES ($1, now(), $2, 'farmer')
       ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id`, [phone, s.country]);
    await this.sql.exec(`INSERT INTO consents (user_id, type, granted, version) VALUES ($1,'sms_alerts',true,'sms-1.0'),($1,'terms',true,'sms-1.0'),($1,'privacy',true,'sms-1.0')`, [r!.id]);
    return r!.id;
  }

  async handle(phone: string, text: string): Promise<{ reply: string; command: string }> {
    const s = await this.sender(phone);
    const t = (k: string, p: Record<string, string | number> = {}) => fitSms(this.i18n.t(k, s.locale, p));
    const n = await this.names(s.country);
    const cmd = parseCommand(text, n.keywords);

    if (cmd.cmd === "help") return { reply: t("sms.help"), command: "help" };
    if (cmd.cmd === "unknown") return { reply: t("sms.not_understood"), command: "unknown" };
    if (cmd.cmd === "stop") {
      if (s.userId) {
        await this.sql.exec(`INSERT INTO consents (user_id, type, granted, version) VALUES ($1,'sms_alerts',false,'sms-1.0')`, [s.userId]);
        await this.sql.exec(`UPDATE alerts SET channels = array_remove(channels, 'sms') WHERE user_id = $1 AND 'sms' = ANY(channels)`, [s.userId]);
        await this.sql.exec(`UPDATE alerts SET active = false WHERE user_id = $1 AND cardinality(channels) = 0`, [s.userId]);
      }
      return { reply: t("sms.stopped"), command: "stop" };
    }

    if (cmd.cmd === "price") {
      const split = splitCommodityMarket(cmd.commodity, n.commodities, n.markets);
      if (!split.commodityId) return { reply: t("sms.unknown_crop", { text: cmd.commodity.slice(0, 30) }), command: "price" };
      if (split.marketText && !split.marketId) return { reply: t("sms.unknown_market", { text: split.marketText.slice(0, 30) }), command: "price" };
      const name = await this.commodityName(split.commodityId, s.locale);
      const ctx = await this.money.resolveDisplay({ currency: s.currency, unit: s.unit, locale: s.locale }, null, s.country);
      const rows = await this.sql.many<{ market: Record<string, string>; amount: string; currency: string; unit_code: string; price_per_kg_local: string; price_per_kg_usd: string; fx_rate_id: string | null; commodity_id: string; observed_at: Date }>(
        `SELECT DISTINCT ON (o.market_id) m.name AS market, o.amount, o.currency, o.unit_code, o.price_per_kg_local, o.price_per_kg_usd, o.fx_rate_id, o.commodity_id, o.observed_at
         FROM price_observations o JOIN markets m ON m.id = o.market_id
         WHERE o.commodity_id = $1 AND o.country_iso2 = $2 AND o.status = 'approved' AND o.observed_at > now() - interval '45 days' AND ($3::uuid IS NULL OR o.market_id = $3)
         ORDER BY o.market_id, o.price_type = 'retail' DESC, o.observed_at DESC`, [split.commodityId, s.country, split.marketId]);
      if (!rows.length) return { reply: t("sms.no_price", { commodity: name, where: split.marketId ? ` @ ${split.marketText}` : "" }), command: "price" };
      const sorted = rows.sort((a, b) => b.observed_at.getTime() - a.observed_at.getTime()).slice(0, 3);
      const vals = await Promise.all(sorted.map((r) => this.money.priceValue(r, ctx)));
      if (sorted.length === 1) {
        const v = vals[0]!;
        return { reply: t("sms.price", { commodity: name, market: this.i18n.pick(sorted[0]!.market, s.locale), price: v.display.amount, currency: v.display.currency, unit: v.display.unit, date: sorted[0]!.observed_at.toISOString().slice(5, 10) }), command: "price" };
      }
      const lines = sorted.map((r, i) => `${this.i18n.pick(r.market, s.locale).split(" (")[0]} ${vals[i]!.display.amount}`).join("; ");
      return { reply: t("sms.price_multi", { commodity: `${name} (${vals[0]!.display.currency}/${vals[0]!.display.unit})`, lines }), command: "price" };
    }

    // ALERT
    const c = resolveName(cmd.commodity, n.commodities);
    if (!c) return { reply: t("sms.unknown_crop", { text: cmd.commodity.slice(0, 30) }), command: "alert" };
    const marketId = cmd.market ? resolveName(cmd.market, n.markets) : null;
    if (cmd.market && !marketId) return { reply: t("sms.unknown_market", { text: cmd.market.slice(0, 30) }), command: "alert" };
    const userId = await this.ensureUser(phone, s);
    await this.sql.exec(`INSERT INTO consents (user_id, type, granted, version) SELECT $1,'sms_alerts',true,'sms-1.0'
                         WHERE NOT coalesce((SELECT granted FROM consents WHERE user_id = $1 AND type = 'sms_alerts' ORDER BY created_at DESC LIMIT 1), false)`, [userId]);
    const ent = await this.billing.entitlements({ id: userId, orgId: null });
    const count = (await this.sql.one<{ n: number }>(`SELECT count(*)::int AS n FROM alerts WHERE user_id = $1 AND active`, [userId]))?.n ?? 0;
    if (count >= ent.alerts_max) return { reply: t("sms.alert_limit"), command: "alert" };
    const kg = await this.money.kgPerUnit(c, s.unit, s.country).catch(() => "1");
    const unit = kg === "1" && s.unit !== "kg" ? "kg" : s.unit;
    const perKg = D(cmd.threshold).div(kg).toDecimalPlaces(6).toString();
    // SMS alerts are only delivered as SMS when the plan includes it; otherwise in-app.
    const channels = ent.alert_channels.includes("sms") ? ["sms", "in_app"] : ["in_app"];
    await this.sql.exec(
      `INSERT INTO alerts (user_id, commodity_id, market_id, country_iso2, price_type, condition, threshold, threshold_currency, threshold_unit, threshold_per_kg_local, channels)
       VALUES ($1,$2,$3,$4,'retail',$5,$6,$7,$8,$9,$10)`, [userId, c, marketId, s.country, cmd.condition, cmd.threshold, s.currency, unit, perKg, channels]);
    return { reply: t("sms.alert_set", { commodity: await this.commodityName(c, s.locale), condition: this.i18n.t(`sms.${cmd.condition}`, s.locale), threshold: cmd.threshold,
      currency: s.currency, unit, where: marketId && cmd.market ? ` @ ${cmd.market}` : "" }), command: "alert" };
  }

  private async commodityName(id: string, locale: string) {
    const r = await this.sql.one<{ name: Record<string, string> }>(`SELECT name FROM commodities WHERE id = $1`, [id]);
    return this.i18n.pick(r?.name, locale);
  }

  /** USSD (Africa's Talking): text accumulates as "1*maize*techiman". Stateless: each request re-parses the path. */
  async ussd(phone: string, text: string): Promise<string> {
    const s = await this.sender(phone);
    const t = (k: string, p: Record<string, string | number> = {}) => this.i18n.t(k, s.locale, p);
    const parts = text ? text.split("*").map((p) => p.trim()) : [];
    const end = (msg: string) => `END ${msg}`;
    if (!parts.length) return t("ussd.menu");
    const [choice, ...rest] = parts;
    if (choice === "1") {
      if (rest.length === 0) return t("ussd.ask_crop");
      if (rest.length === 1) return t("ussd.ask_market");
      const r = await this.handle(phone, `PRICE ${rest[0]} ${rest[1] === "0" ? "" : rest[1]}`.trim());
      return end(r.reply);
    }
    if (choice === "2") {
      if (rest.length === 0) return t("ussd.ask_crop");
      if (rest.length === 1) return t("ussd.ask_direction");
      if (rest.length === 2) return ["1", "2"].includes(rest[1]!) ? t("ussd.ask_amount", { unit: s.unit, currency: s.currency }) : t("ussd.invalid");
      const r = await this.handle(phone, `ALERT ${rest[0]} ${rest[1] === "2" ? "ABOVE" : "BELOW"} ${rest[2]}`);
      return end(r.reply);
    }
    if (choice === "3") return end((await this.handle(phone, "STOP")).reply);
    return t("ussd.invalid");
  }

  async record(provider: string, ref: string | null, phone: string, userId: string | null, text: string, command: string, reply: string) {
    await this.sql.exec(`INSERT INTO sms_inbound (provider, provider_ref, from_hash, user_id, text, command, reply) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [provider, ref, hmac(process.env.OTP_PEPPER ?? "pepper", phone), userId, text.slice(0, 480), command, reply]);
  }

  async isDuplicate(provider: string, ref: string | null) {
    return ref ? Boolean(await this.sql.one(`SELECT 1 FROM sms_inbound WHERE provider = $1 AND provider_ref = $2`, [provider, ref])) : false;
  }

  replySms(to: string, body: string) { return this.queue.raw("notifications", "send-sms", { to, body }); }
}

const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

@ApiTags("sms-ussd")
@Public()
@SkipThrottle()
@Controller("v1/webhooks")
export class SmsController {
  constructor(private readonly s: SmsService) {}

  @Post("sms/:provider") @HttpCode(200) @ApiOperation({ operationId: "sms_inbound" })
  async inbound(@Param("provider") provider: string, @Req() req: RawRequest, @Res() res: Response) {
    if (!["africastalking", "twilio"].includes(provider)) throw AppError.notFound("provider");
    verifyWebhook(provider, req);
    const b = req.body as Record<string, string>;
    const from = provider === "twilio" ? b.From : b.from;
    const text = (provider === "twilio" ? b.Body : b.text) ?? "";
    const ref = (provider === "twilio" ? b.MessageSid : b.id) ?? null;
    if (!from || !/^\+[1-9]\d{6,14}$/.test(from)) throw AppError.badRequest("sender_invalid");
    if (await this.s.isDuplicate(provider, ref)) { res.status(200).type("text/plain").send(""); return; }
    let reply: string, command: string;
    try { ({ reply, command } = await this.s.handle(from, text)); }
    catch (e) { reply = "AgriPrice: service unavailable for your number."; command = "error"; if (!(e instanceof AppError)) throw e; }
    await this.s.record(provider, ref, from, null, text, command, reply);
    if (provider === "twilio") { res.status(200).type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xml(reply)}</Message></Response>`); return; }
    // Africa's Talking two-way SMS: the reply goes out as a normal outbound SMS.
    await this.s.replySms(from, reply);
    res.status(200).type("text/plain").send("");
  }

  @Post("ussd/:provider") @HttpCode(200) @ApiOperation({ operationId: "ussd_session" })
  async ussd(@Param("provider") provider: string, @Req() req: RawRequest, @Res() res: Response) {
    if (provider !== "africastalking") throw AppError.notFound("provider");
    verifyWebhook(provider, req);
    const b = req.body as Record<string, string>;
    if (!b.phoneNumber || !/^\+[1-9]\d{6,14}$/.test(b.phoneNumber)) throw AppError.badRequest("sender_invalid");
    const out = await this.s.ussd(b.phoneNumber, String(b.text ?? "").slice(0, 200)).catch(() => "END Service unavailable. Please try again later.");
    res.status(200).type("text/plain").send(out.slice(0, 182)); // USSD page limit
  }
}

@Module({ controllers: [SmsController], providers: [SmsService] })
export class SmsModule {}
