import { Body, Controller, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Put, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { Type } from "class-transformer";
import { IsIn, IsObject, IsOptional, IsString, Matches, MaxLength, ValidateIf, ValidateNested } from "class-validator";
import type { Request } from "express";
import { createHmac } from "node:crypto";
import { AuthUser, CurrentUser, Public } from "../../common/auth/auth.common";
import { safeEqual } from "../../common/crypto/crypto";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { cursor } from "../../common/http/request-context";
import { PagedQuery } from "../geo/geo.dto";

export const CATEGORIES = ["price_alert", "market_update", "weather", "system", "weekly_insight"] as const;
const CHANNELS = ["push", "email", "sms", "whatsapp", "in_app"] as const;
/** Defaults when a user has never set preferences. SMS/WhatsApp cost money, so they stay opt-in. */
export const DEFAULT_CATEGORY_CHANNELS: Record<string, string[]> = {
  price_alert: ["push", "in_app"], market_update: ["in_app"], weather: ["push", "in_app"], system: ["email", "in_app"], weekly_insight: ["email", "in_app"],
};

class InboxQuery extends PagedQuery {
  @ApiPropertyOptional({ enum: CATEGORIES }) @IsOptional() @IsIn(CATEGORIES) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(["true", "false"]) unread?: "true" | "false";
}
class CategoryQuery { @ApiPropertyOptional({ enum: CATEGORIES }) @IsOptional() @IsIn(CATEGORIES) category?: string }
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
class QuietHoursDto {
  @ApiProperty() @Matches(HHMM) start: string;
  @ApiProperty() @Matches(HHMM) end: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) timezone?: string;
}
class PreferencesDto {
  @ApiProperty() @IsObject() categories: Record<string, string[]>;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @ValidateNested() @Type(() => QuietHoursDto) quietHours?: QuietHoursDto | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(/^\+[1-9]\d{6,14}$/) whatsappNumber?: string | null;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly sql: Sql) {}

  async inbox(user: AuthUser, q: InboxQuery) {
    const c = cursor.decode<{ t: string; id: string }>(q.cursor);
    const rows = await this.sql.many<{ id: string; category: string; title: string; body: string; data: Record<string, unknown>; read_at: Date | null; created_at: Date }>(
      `SELECT id, category, title, body, data, read_at, created_at FROM notifications
       WHERE user_id = $1 AND ($2::text IS NULL OR category = $2)
         AND ($3::boolean IS NULL OR (read_at IS NULL) = $3)
         AND ($4::timestamptz IS NULL OR (created_at, id) < ($4, $5::uuid))
       ORDER BY created_at DESC, id DESC LIMIT $6`,
      [user.id, q.category ?? null, q.unread ? q.unread === "true" : null, c?.t ?? null, c?.id ?? null, q.limit + 1]);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      data: page.map((n) => ({ id: n.id, category: n.category, title: n.title, body: n.body, data: n.data, read: Boolean(n.read_at), readAt: n.read_at?.toISOString() ?? null, createdAt: n.created_at.toISOString() })),
      nextCursor: rows.length > q.limit && last ? cursor.encode({ t: last.created_at.toISOString(), id: last.id }) : null,
    };
  }

  async unread(user: AuthUser) {
    const rows = await this.sql.many<{ category: string; n: number }>(`SELECT category, count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL GROUP BY category`, [user.id]);
    return { total: rows.reduce((a, r) => a + r.n, 0), byCategory: Object.fromEntries(rows.map((r) => [r.category, r.n])) };
  }

  async markRead(user: AuthUser, id: string) {
    const n = await this.sql.exec(`UPDATE notifications SET read_at = coalesce(read_at, now()) WHERE id = $1 AND user_id = $2`, [id, user.id]);
    if (!n) throw AppError.notFound("notification");
  }

  async readAll(user: AuthUser, category?: string) {
    await this.sql.exec(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND ($2::text IS NULL OR category = $2)`, [user.id, category ?? null]);
  }

  async prefs(user: AuthUser) {
    const r = await this.sql.one<{ categories: Record<string, string[]>; quiet_start: string | null; quiet_end: string | null; timezone: string | null; whatsapp_number: string | null }>(
      `SELECT categories, to_char(quiet_start, 'HH24:MI') AS quiet_start, to_char(quiet_end, 'HH24:MI') AS quiet_end, timezone, whatsapp_number
       FROM notification_preferences WHERE user_id = $1`, [user.id]);
    const tz = r?.timezone ?? (await this.sql.one<{ timezone: string }>(`SELECT c.timezone FROM users u JOIN countries c ON c.iso2 = u.country_iso2 WHERE u.id = $1`, [user.id]))?.timezone;
    return {
      categories: { ...DEFAULT_CATEGORY_CHANNELS, ...(r?.categories ?? {}) },
      quietHours: r?.quiet_start && r.quiet_end ? { start: r.quiet_start, end: r.quiet_end, timezone: tz } : null,
      whatsappNumber: r?.whatsapp_number ?? null,
    };
  }

  async putPrefs(user: AuthUser, d: PreferencesDto) {
    for (const [cat, chans] of Object.entries(d.categories)) {
      if (!(CATEGORIES as readonly string[]).includes(cat)) throw AppError.unprocessable("category_unknown", cat);
      if (!Array.isArray(chans) || chans.some((c) => !(CHANNELS as readonly string[]).includes(c))) throw AppError.unprocessable("channel_unknown", `Invalid channels for ${cat}`);
    }
    if (d.quietHours?.timezone && !isValidTz(d.quietHours.timezone)) throw AppError.unprocessable("timezone_invalid", d.quietHours.timezone);
    await this.sql.exec(
      `INSERT INTO notification_preferences (user_id, categories, quiet_start, quiet_end, timezone, whatsapp_number, updated_at)
       VALUES ($1, $2, $3::time, $4::time, $5, $6, now())
       ON CONFLICT (user_id) DO UPDATE SET categories = EXCLUDED.categories, quiet_start = EXCLUDED.quiet_start, quiet_end = EXCLUDED.quiet_end,
         timezone = EXCLUDED.timezone, whatsapp_number = EXCLUDED.whatsapp_number, updated_at = now()`,
      [user.id, JSON.stringify(d.categories), d.quietHours?.start ?? null, d.quietHours?.end ?? null, d.quietHours?.timezone ?? null, d.whatsappNumber ?? null]);
    return this.prefs(user);
  }

  /** Maps provider-specific receipt payloads to a delivery status update. */
  async receipt(provider: string, req: Request & { rawBody?: Buffer }) {
    this.verify(provider, req);
    const b = req.body as Record<string, any>;
    const updates: { id: string; status: string; error?: string }[] = [];
    switch (provider) {
      case "twilio":
        updates.push({ id: b.MessageSid, status: mapStatus(b.MessageStatus), error: b.ErrorCode });
        break;
      case "africastalking":
        updates.push({ id: b.id, status: mapStatus(b.status), error: b.failureReason });
        break;
      case "postmark":
        updates.push({ id: b.MessageID, status: b.RecordType === "Delivery" ? "delivered" : b.RecordType === "Bounce" ? "bounced" : "sent", error: b.Description });
        break;
      case "ses": {
        const msg = typeof b.Message === "string" ? JSON.parse(b.Message) : b;
        updates.push({ id: msg.mail?.messageId, status: msg.notificationType === "Delivery" ? "delivered" : msg.notificationType === "Bounce" ? "bounced" : "failed" });
        break;
      }
      case "whatsapp":
        for (const e of b.entry ?? []) for (const ch of e.changes ?? []) for (const s of ch.value?.statuses ?? [])
          updates.push({ id: s.id, status: mapStatus(s.status), error: s.errors?.[0]?.title });
        break;
      default: throw AppError.notFound("provider");
    }
    for (const u of updates.filter((x) => x.id)) {
      // Never regress a terminal status (receipts can arrive out of order).
      await this.sql.exec(
        `UPDATE notification_deliveries SET status = $3, last_error = coalesce($4, last_error),
           delivered_at = CASE WHEN $3 = 'delivered' THEN now() ELSE delivered_at END
         WHERE provider = $1 AND provider_message_id = $2 AND status NOT IN ('delivered','bounced')`,
        [provider, String(u.id), u.status, u.error ? String(u.error).slice(0, 500) : null]);
    }
  }

  private verify(provider: string, req: Request & { rawBody?: Buffer }) {
    const env = process.env;
    if (provider === "twilio") {
      const token = env.TWILIO_AUTH_TOKEN; const sig = req.header("x-twilio-signature");
      if (!token || !sig) throw AppError.unauthorized("signature_missing");
      const url = `${env.API_PUBLIC_URL}${req.originalUrl}`;
      const params = req.body as Record<string, string>;
      const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
      if (!safeEqual(createHmac("sha1", token).update(data).digest("base64"), sig)) throw AppError.unauthorized("signature_invalid");
      return;
    }
    if (provider === "whatsapp") {
      const secret = env.WHATSAPP_APP_SECRET; const sig = req.header("x-hub-signature-256");
      if (!secret || !sig || !req.rawBody) throw AppError.unauthorized("signature_missing");
      if (!safeEqual(`sha256=${createHmac("sha256", secret).update(req.rawBody).digest("hex")}`, sig)) throw AppError.unauthorized("signature_invalid");
      return;
    }
    // Africa's Talking, Postmark and SES (via SNS HTTPS subscription) are configured with a secret URL token.
    const expected = env.WEBHOOK_SHARED_SECRET;
    const got = (req.query.token as string | undefined) ?? req.header("x-webhook-token");
    if (!expected || !got || !safeEqual(expected, got)) throw AppError.unauthorized("signature_invalid");
  }
}

function mapStatus(s: string | undefined): string {
  const v = (s ?? "").toLowerCase();
  if (["delivered", "success", "read"].includes(v)) return "delivered";
  if (["sent", "queued", "accepted", "submitted", "buffered"].includes(v)) return "sent";
  if (["undelivered", "failed", "rejected", "absentsubscriber", "expired"].includes(v)) return "failed";
  return "sent";
}

function isValidTz(tz: string) { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } }

@ApiTags("notifications")
@ApiBearerAuth()
@Controller("v1/notifications")
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get() @ApiOperation({ operationId: "notifications_list" })
  list(@CurrentUser() u: AuthUser, @Query() q: InboxQuery) { return this.svc.inbox(u, q); }

  @Get("unread-count") @ApiOperation({ operationId: "notifications_unread_count" })
  unread(@CurrentUser() u: AuthUser) { return this.svc.unread(u); }

  @Post("read-all") @HttpCode(204) @ApiOperation({ operationId: "notifications_read_all" })
  async readAll(@CurrentUser() u: AuthUser, @Query() q: CategoryQuery) { await this.svc.readAll(u, q.category); }

  @Post(":id/read") @HttpCode(204) @ApiOperation({ operationId: "notifications_mark_read" })
  async read(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { await this.svc.markRead(u, id); }

  @Get("preferences") @ApiOperation({ operationId: "notifications_preferences_get" })
  prefs(@CurrentUser() u: AuthUser) { return this.svc.prefs(u); }

  @Put("preferences") @ApiOperation({ operationId: "notifications_preferences_put" })
  putPrefs(@CurrentUser() u: AuthUser, @Body() d: PreferencesDto) { return this.svc.putPrefs(u, d); }
}

@ApiTags("notifications")
@Public()
@SkipThrottle()
@Controller("v1/webhooks")
export class WebhooksController {
  constructor(private readonly svc: NotificationsService) {}

  @Post("receipts/:provider") @HttpCode(204) @ApiOperation({ operationId: "notifications_receipt_webhook" })
  async receipt(@Param("provider") provider: string, @Req() req: Request) { await this.svc.receipt(provider, req); }
}

@Module({ controllers: [NotificationsController, WebhooksController], providers: [NotificationsService] })
export class NotificationsModule {}
