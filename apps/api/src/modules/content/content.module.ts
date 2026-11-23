import { Body, Controller, Get, HttpCode, Injectable, Logger, Module, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from "class-validator";
import { AuthUser, CurrentUser, OptionalUser, Public } from "../../common/auth/auth.common";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { I18nService } from "../../common/i18n/i18n.service";
import { Display, DisplayHints } from "../../common/money/money.service";
import { Cache } from "../../common/redis/redis.module";
import { StorageService } from "../../common/storage/storage.service";
import { upperIso } from "../geo/geo.dto";

class CountryQ { @IsOptional() @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country?: string }
class StoriesQ extends CountryQ { @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit: number = 10 }
class FaqQ extends CountryQ { @IsOptional() @IsString() @MaxLength(40) category?: string }
class ArticlesQ extends CountryQ { @IsOptional() @IsString() @MaxLength(100) q?: string; @IsOptional() @IsString() @MaxLength(40) tag?: string }
class ConfigQ extends CountryQ { @IsOptional() @IsIn(["android", "ios", "web"]) platform?: string }

@Injectable()
export class ContentService {
  constructor(private readonly sql: Sql, private readonly i18n: I18nService, private readonly cache: Cache, private readonly storage: StorageService) {}

  async stories(country: string | undefined, limit: number, locale: string) {
    const rows = await this.sql.many<{ id: string; title: Record<string, string>; body: Record<string, string>; person_name: string | null; person_role: string | null; image_key: string | null; published_at: Date }>(
      `SELECT * FROM success_stories WHERE published_at <= now() AND ($1::char(2) IS NULL OR country_iso2 = $1 OR country_iso2 IS NULL) ORDER BY published_at DESC LIMIT $2`, [country ?? null, limit]);
    return rows.map((s) => ({ id: s.id, title: this.i18n.pick(s.title, locale), body: this.i18n.pick(s.body, locale), personName: s.person_name, personRole: s.person_role,
      imageUrl: this.storage.publicUrl(this.storage.cfg.s3.imagesBucket, s.image_key), publishedAt: s.published_at.toISOString() }));
  }

  async faqs(country: string | undefined, category: string | undefined, locale: string) {
    const rows = await this.sql.many<{ id: string; category: string; question: Record<string, string>; answer: Record<string, string> }>(
      `SELECT DISTINCT ON (category, sort_order, question->>'en') * FROM faqs WHERE published AND ($1::char(2) IS NULL OR country_iso2 = $1 OR country_iso2 IS NULL)
         AND ($2::text IS NULL OR category = $2) ORDER BY category, sort_order, question->>'en', (country_iso2 IS NULL)`, [country ?? null, category ?? null]);
    return rows.map((f) => ({ id: f.id, category: f.category, question: this.i18n.pick(f.question, locale), answer: this.i18n.pick(f.answer, locale) }));
  }

  async articles(q: ArticlesQ, locale: string) {
    const rows = await this.sql.many<{ slug: string; title: Record<string, string>; tags: string[]; updated_at: Date }>(
      `SELECT slug, title, tags, updated_at FROM help_articles WHERE published_at <= now() AND ($1::char(2) IS NULL OR country_iso2 = $1 OR country_iso2 IS NULL)
         AND ($2::text IS NULL OR jsonb_text_values(title) ILIKE '%' || $2 || '%' OR jsonb_text_values(body) ILIKE '%' || $2 || '%')
         AND ($3::text IS NULL OR $3 = ANY(tags)) ORDER BY updated_at DESC LIMIT 100`, [q.country ?? null, q.q ?? null, q.tag ?? null]);
    return rows.map((a) => ({ slug: a.slug, title: this.i18n.pick(a.title, locale), tags: a.tags, updatedAt: a.updated_at.toISOString() }));
  }

  async article(slug: string, locale: string) {
    const a = await this.sql.one<{ slug: string; title: Record<string, string>; body: Record<string, string>; tags: string[]; updated_at: Date }>(`SELECT * FROM help_articles WHERE slug = $1 AND published_at <= now()`, [slug]);
    if (!a) throw AppError.notFound("article");
    return { slug: a.slug, title: this.i18n.pick(a.title, locale), body: this.i18n.pick(a.body, locale), tags: a.tags, updatedAt: a.updated_at.toISOString() };
  }

  /** Every number is computed from live tables (cached 1 h). Nothing is typed in by hand. */
  impact(country?: string) {
    return this.cache.wrap(`content:impact:${country ?? "all"}`, 3600, async () => {
      const r = await this.sql.one<Record<string, number | null>>(
        `SELECT (SELECT count(*) FROM countries WHERE active)::int AS countries,
                (SELECT count(*) FROM markets WHERE active AND ($1::char(2) IS NULL OR country_iso2 = $1))::int AS markets,
                (SELECT count(DISTINCT commodity_id) FROM commodity_country_profiles WHERE tracked AND ($1::char(2) IS NULL OR country_iso2 = $1))::int AS commodities,
                (SELECT coalesce(sum(n), 0) FROM price_daily WHERE ($1::char(2) IS NULL OR country_iso2 = $1))::bigint AS price_records,
                (SELECT count(*) FROM users WHERE deletion_scheduled_at IS NULL AND ($1::char(2) IS NULL OR country_iso2 = $1))::int AS users,
                (SELECT count(*) FROM users WHERE role = 'farmer' AND deletion_scheduled_at IS NULL AND ($1::char(2) IS NULL OR country_iso2 = $1))::int AS farmers,
                (SELECT count(DISTINCT submitted_by) FROM price_observations WHERE source = 'crowd' AND created_at > now() - interval '30 days' AND ($1::char(2) IS NULL OR country_iso2 = $1))::int AS contributors,
                (SELECT count(*) FROM alert_events WHERE triggered_at > now() - interval '30 days')::int AS alerts,
                (SELECT count(*) FROM forecast_runs WHERE is_latest AND ($1::char(2) IS NULL OR country_iso2 = $1))::int AS series,
                (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mape) FROM backtest_metrics b JOIN model_versions m ON m.id = b.model_version_id
                  WHERE m.status = 'production' AND b.horizon_months = 1)::float8 AS mape`, [country ?? null]);
      return {
        countries: r!.countries, markets: r!.markets, commodities: r!.commodities, priceRecords: r!.price_records, users: r!.users, farmers: r!.farmers,
        crowdContributors30d: r!.contributors, alertsDelivered30d: r!.alerts, forecastSeries: r!.series,
        medianForecastMape1m: r!.mape != null ? Math.round(r!.mape * 100) / 100 : null, computedAt: new Date().toISOString(),
      };
    });
  }

  async appConfig(country?: string, platform?: string) {
    const rows = await this.sql.many<{ key: string; value: unknown; country_iso2: string | null }>(
      `SELECT key, value, country_iso2 FROM app_config WHERE country_iso2 IS NULL OR country_iso2 = $1 ORDER BY (country_iso2 IS NOT NULL)`, [country ?? null]);
    const merged = new Map<string, unknown>();
    for (const r of rows) merged.set(r.key, r.value); // country rows come last and override
    const minVersion: Record<string, string> = {}, latestVersion: Record<string, string> = {}, flags: Record<string, unknown> = {};
    for (const [k, v] of merged) {
      if (k.startsWith("min_app_version.")) minVersion[k.slice(16)] = String(v);
      else if (k.startsWith("latest_app_version.")) latestVersion[k.slice(19)] = String(v);
      else if (k.startsWith("flag.")) flags[k.slice(5)] = v;
    }
    if (platform) for (const o of [minVersion, latestVersion]) for (const p of Object.keys(o)) if (p !== platform) delete o[p];
    return { minVersion, latestVersion, flags };
  }
}

// ── support ──
class TicketCreateDto {
  @IsIn(["account", "prices", "payments", "marketplace", "technical", "other"]) category: string;
  @IsString() @Length(3, 160) subject: string;
  @IsString() @Length(1, 5000) body: string;
  @IsOptional() @IsUUID() orderId?: string;
}
class TextDto { @IsString() @Length(1, 5000) body: string }
class HandoffDto {
  @IsString() @Length(1, 2000) summary: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) transcript?: { role: string; text: string }[];
  @IsOptional() @IsIn(["account", "prices", "payments", "marketplace", "technical", "other"]) category?: string;
}
class FeedbackDto { @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number; @IsOptional() @IsString() @MaxLength(2000) comment?: string; @IsOptional() @IsObject() context?: Record<string, unknown> }
class IssueDto {
  @IsIn(["bug", "wrong_price", "wrong_market", "crash", "other"]) kind: string;
  @IsString() @Length(1, 5000) description: string;
  @IsOptional() @IsString() @MaxLength(100) screen?: string;
  @IsOptional() @IsString() @MaxLength(32) appVersion?: string;
  @IsOptional() @IsObject() device?: Record<string, unknown>;
}

@Injectable()
export class SupportService {
  private readonly log = new Logger(SupportService.name);
  constructor(private readonly sql: Sql) {}

  async ticket(userId: string, id: string) {
    const t = await this.sql.one<{ id: string; category: string; subject: string; status: string; priority: string; created_at: Date; updated_at: Date }>(`SELECT * FROM support_tickets WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (!t) throw AppError.notFound("ticket");
    const msgs = await this.sql.many<{ id: string; body: string; from_staff: boolean; created_at: Date }>(`SELECT id, body, from_staff, created_at FROM support_messages WHERE ticket_id = $1 ORDER BY created_at`, [id]);
    return { id: t.id, category: t.category, subject: t.subject, status: t.status, priority: t.priority, createdAt: t.created_at.toISOString(), updatedAt: t.updated_at.toISOString(),
      messages: msgs.map((m) => ({ id: m.id, body: m.body, fromStaff: m.from_staff, createdAt: m.created_at.toISOString() })) };
  }

  async list(user: AuthUser) {
    const rows = await this.sql.many<{ id: string }>(`SELECT id FROM support_tickets WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50`, [user.id]);
    return Promise.all(rows.map((r) => this.ticket(user.id, r.id)));
  }

  async create(user: AuthUser, d: TicketCreateDto, priority = "normal") {
    if (d.orderId && !(await this.sql.one(`SELECT 1 FROM orders WHERE id = $1 AND (buyer_id = $2 OR seller_id = $2)`, [d.orderId, user.id]))) throw AppError.unprocessable("order_invalid", "Order not found");
    const open = (await this.sql.one<{ n: number }>(`SELECT count(*)::int AS n FROM support_tickets WHERE user_id = $1 AND status IN ('open','pending')`, [user.id]))?.n ?? 0;
    if (open >= 10) throw AppError.tooMany("ticket_limit", "You have too many open tickets");
    const t = await this.sql.tx(async (c) => {
      const r = (await c.query<{ id: string }>(`INSERT INTO support_tickets (user_id, category, subject, priority, order_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [user.id, d.category, d.subject, d.category === "payments" ? "high" : priority, d.orderId ?? null])).rows[0]!;
      await c.query(`INSERT INTO support_messages (ticket_id, author_id, body) VALUES ($1,$2,$3)`, [r.id, user.id, d.body]);
      return r;
    });
    await this.helpdesk("ticket.created", { ticketId: t.id, userId: user.id, category: d.category, subject: d.subject, body: d.body, priority });
    return this.ticket(user.id, t.id);
  }

  async reply(user: AuthUser, id: string, body: string) {
    await this.ticket(user.id, id);
    await this.sql.exec(`INSERT INTO support_messages (ticket_id, author_id, body) VALUES ($1,$2,$3)`, [id, user.id, body]);
    await this.sql.exec(`UPDATE support_tickets SET status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END WHERE id = $1`, [id]);
    await this.helpdesk("ticket.replied", { ticketId: id, userId: user.id, body });
    return this.ticket(user.id, id);
  }

  async handoff(user: AuthUser, d: HandoffDto) {
    const transcript = (d.transcript ?? []).map((m) => `${String(m.role).slice(0, 10)}: ${String(m.text).slice(0, 1000)}`).join("\n");
    const t = await this.create(user, { category: d.category ?? "other", subject: `Chat handoff: ${d.summary.slice(0, 120)}`, body: `${d.summary}\n\n--- transcript ---\n${transcript}`.slice(0, 5000) }, "high");
    await this.helpdesk("chat.handoff", { ticketId: t.id, userId: user.id, summary: d.summary, transcript: d.transcript ?? [] });
    return t;
  }

  /** Helpdesk integration (Zendesk/Freshdesk/Chatwoot) via a signed outbound webhook. */
  private async helpdesk(event: string, payload: Record<string, unknown>) {
    const url = process.env.HELPDESK_WEBHOOK_URL;
    if (!url) return;
    const body = JSON.stringify({ event, ...payload, at: new Date().toISOString() });
    const { createHmac } = await import("node:crypto");
    const sig = createHmac("sha256", process.env.HELPDESK_WEBHOOK_SECRET ?? "").update(body).digest("hex");
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-AgriPrice-Signature": sig }, body, signal: AbortSignal.timeout(8000) });
      const j = (await r.json().catch(() => ({}))) as { id?: string };
      if (j.id && payload.ticketId) await this.sql.exec(`UPDATE support_tickets SET helpdesk_ref = $2 WHERE id = $1 AND helpdesk_ref IS NULL`, [payload.ticketId, String(j.id)]);
    } catch (e) {
      this.log.warn({ err: (e as Error).message, event }, "helpdesk webhook failed");
    }
  }

  async feedback(user: AuthUser | null, d: FeedbackDto) {
    await this.sql.exec(`INSERT INTO feedback (user_id, rating, comment, context) VALUES ($1,$2,$3,$4)`, [user?.id ?? null, d.rating ?? null, d.comment ?? null, d.context ?? {}]);
  }

  async issue(user: AuthUser | null, d: IssueDto) {
    const r = await this.sql.one<{ id: string }>(`INSERT INTO issue_reports (user_id, kind, description, screen, app_version, device) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [user?.id ?? null, d.kind, d.description, d.screen ?? null, d.appVersion ?? null, d.device ?? {}]);
    return { id: r!.id };
  }
}

@ApiTags("content")
@Public()
@Controller("v1")
export class ContentController {
  constructor(private readonly c: ContentService, private readonly i18n: I18nService) {}
  private loc(d: DisplayHints) { return d.locale ?? "en"; }

  @Get("content/stories") @ApiOperation({ operationId: "content_stories_list" })
  stories(@Query() q: StoriesQ, @Display() d: DisplayHints) { return this.c.stories(q.country, q.limit, this.loc(d)); }

  @Get("content/faqs") @ApiOperation({ operationId: "content_faqs_list" })
  faqs(@Query() q: FaqQ, @Display() d: DisplayHints) { return this.c.faqs(q.country, q.category, this.loc(d)); }

  @Get("content/articles") @ApiOperation({ operationId: "content_articles_list" })
  articles(@Query() q: ArticlesQ, @Display() d: DisplayHints) { return this.c.articles(q, this.loc(d)); }

  @Get("content/articles/:slug") @ApiOperation({ operationId: "content_articles_get" })
  article(@Param("slug") slug: string, @Display() d: DisplayHints) {
    if (!/^[a-z0-9-]{1,120}$/.test(slug)) throw AppError.notFound("article");
    return this.c.article(slug, this.loc(d));
  }

  @Get("content/impact") @ApiOperation({ operationId: "content_impact" })
  impact(@Query() q: CountryQ) { return this.c.impact(q.country); }

  @Get("app-config") @ApiOperation({ operationId: "content_app_config" })
  config(@Query() q: ConfigQ) { return this.c.appConfig(q.country, q.platform); }
}

@ApiTags("support")
@ApiBearerAuth()
@Controller("v1/support")
export class SupportController {
  constructor(private readonly s: SupportService) {}

  @Get("tickets") @ApiOperation({ operationId: "support_tickets_list" })
  list(@CurrentUser() u: AuthUser) { return this.s.list(u); }

  @Post("tickets") @ApiOperation({ operationId: "support_tickets_create" })
  create(@CurrentUser() u: AuthUser, @Body() d: TicketCreateDto) { return this.s.create(u, d); }

  @Get("tickets/:id") @ApiOperation({ operationId: "support_tickets_get" })
  get(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { return this.s.ticket(u.id, id); }

  @Post("tickets/:id/messages") @ApiOperation({ operationId: "support_tickets_reply" })
  reply(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() d: TextDto) { return this.s.reply(u, id, d.body); }

  @Post("chat-handoff") @HttpCode(202) @ApiOperation({ operationId: "support_chat_handoff" })
  handoff(@CurrentUser() u: AuthUser, @Body() d: HandoffDto) { return this.s.handoff(u, d); }

  @Public() @Post("feedback") @HttpCode(204) @ApiOperation({ operationId: "support_feedback" })
  async feedback(@OptionalUser() u: AuthUser | null, @Body() d: FeedbackDto) { await this.s.feedback(u, d); }

  @Public() @Post("issues") @ApiOperation({ operationId: "support_issue_report" })
  issue(@OptionalUser() u: AuthUser | null, @Body() d: IssueDto) { return this.s.issue(u, d); }
}

@Module({ controllers: [ContentController, SupportController], providers: [ContentService, SupportService] })
export class ContentModule {}
