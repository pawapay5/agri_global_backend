import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import type { AuthUser } from "../../common/auth/auth.common";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { cursor } from "../../common/http/request-context";
import { QueueService } from "../../common/queue/queues";
import { REDIS } from "../../common/redis/redis.module";
import { MarketplaceService } from "../marketplace/marketplace.service";
import { MediaService } from "../uploads/media.service";
import { messageRateOk, scanMessage } from "./scam.logic";

export interface MessageRow {
  id: string; conversation_id: string; sender_id: string | null; kind: string; body: string | null; payload: Record<string, unknown>; flags: string[]; client_id: string | null; created_at: Date;
}

const WARNING = "Stay safe: never pay outside AgriPrice and never share codes or PINs. Payments through the app are protected by escrow.";

/** Hook used by the gateway to fan out events (set at gateway init). */
export type Emitter = (room: string, event: string, data: unknown) => void;

@Injectable()
export class MessagingService {
  emit: Emitter = () => undefined;
  constructor(
    private readonly sql: Sql, @Inject(REDIS) private readonly redis: Redis, private readonly queue: QueueService,
    private readonly market: MarketplaceService, private readonly media: MediaService,
  ) {}

  dto(m: MessageRow) {
    return {
      id: m.id, conversationId: m.conversation_id, senderId: m.sender_id, kind: m.kind, body: m.body,
      payload: m.kind === "image" ? { ...m.payload, urls: this.media.urls((m.payload.variants as Record<string, string>) ?? {}) } : m.payload,
      flags: m.flags, warning: m.flags.length ? WARNING : null, clientId: m.client_id, createdAt: m.created_at.toISOString(),
    };
  }

  async assertMember(conversationId: string, userId: string) {
    const r = await this.sql.one(`SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`, [conversationId, userId]);
    if (!r) throw AppError.notFound("conversation");
  }

  private async otherMembers(conversationId: string, userId: string) {
    return (await this.sql.many<{ user_id: string }>(`SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id <> $2`, [conversationId, userId])).map((r) => r.user_id);
  }

  memberConversations(userId: string) {
    return this.sql.many<{ conversation_id: string }>(`SELECT conversation_id FROM conversation_members WHERE user_id = $1`, [userId]);
  }

  async isOnline(userId: string) { return (await this.redis.exists(`presence:${userId}`)) === 1; }

  async open(user: AuthUser, d: { userId: string; listingId?: string; orderId?: string }) {
    if (d.userId === user.id) throw AppError.unprocessable("self_conversation", "You can't message yourself");
    if (await this.market.blocked(user.id, d.userId)) throw AppError.forbidden("blocked", "You can't message this user");
    const target = await this.sql.one<{ suspended_at: Date | null }>(`SELECT suspended_at FROM users WHERE id = $1 AND deletion_scheduled_at IS NULL`, [d.userId]);
    if (!target) throw AppError.notFound("user");
    if (d.orderId && !(await this.sql.one(`SELECT 1 FROM orders WHERE id = $1 AND ((buyer_id = $2 AND seller_id = $3) OR (buyer_id = $3 AND seller_id = $2))`, [d.orderId, user.id, d.userId])))
      throw AppError.unprocessable("order_mismatch", "That order isn't between you two");
    const existing = await this.sql.one<{ id: string }>(
      `SELECT c.id FROM conversations c
       JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = $1
       JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = $2
       WHERE c.listing_id IS NOT DISTINCT FROM $3::uuid AND c.order_id IS NOT DISTINCT FROM $4::uuid
         AND (SELECT count(*) FROM conversation_members m WHERE m.conversation_id = c.id) = 2 LIMIT 1`,
      [user.id, d.userId, d.listingId ?? null, d.orderId ?? null]);
    let id = existing?.id;
    if (!id) {
      const recent = await this.redis.incr(`rl:newconv:${user.id}`);
      if (recent === 1) await this.redis.expire(`rl:newconv:${user.id}`, 86_400);
      const rate = messageRateOk(0, 0, recent - 1, true);
      if (!rate.ok) throw AppError.tooMany(rate.code, "You're starting too many conversations. Try again tomorrow.");
      id = await this.sql.tx(async (c) => {
        const conv = (await c.query<{ id: string }>(`INSERT INTO conversations (country_iso2, listing_id, order_id, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
          [user.country, d.listingId ?? null, d.orderId ?? null, user.id])).rows[0]!;
        await c.query(`INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2),($1,$3)`, [conv.id, user.id, d.userId]);
        return conv.id;
      });
    }
    return this.conversation(user, id);
  }

  async conversation(user: AuthUser, id: string) {
    await this.assertMember(id, user.id);
    const c = await this.sql.one<{ id: string; listing_id: string | null; order_id: string | null; last_message_at: Date | null }>(`SELECT * FROM conversations WHERE id = $1`, [id]);
    const members = await this.sql.many<{ user_id: string; name: string | null; last_read_at: Date | null }>(
      `SELECT m.user_id, coalesce(sp.display_name, u.full_name) AS name, m.last_read_at FROM conversation_members m JOIN users u ON u.id = m.user_id
       LEFT JOIN seller_profiles sp ON sp.user_id = m.user_id WHERE m.conversation_id = $1`, [id]);
    const last = await this.sql.one<MessageRow>(`SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`, [id]);
    const mine = members.find((m) => m.user_id === user.id);
    const unread = await this.sql.one<{ n: number }>(`SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1 AND sender_id <> $2 AND created_at > coalesce($3, '-infinity'::timestamptz)`, [id, user.id, mine?.last_read_at ?? null]);
    return {
      id, listingId: c!.listing_id, orderId: c!.order_id, lastMessageAt: c!.last_message_at?.toISOString() ?? null, unread: unread?.n ?? 0,
      lastMessage: last ? this.dto(last) : null,
      members: await Promise.all(members.map(async (m) => ({ userId: m.user_id, name: m.name, online: await this.isOnline(m.user_id), lastReadAt: m.last_read_at?.toISOString() ?? null }))),
    };
  }

  async list(user: AuthUser, q: { cursor?: string; limit: number }) {
    const c = cursor.decode<{ t: string; id: string }>(q.cursor);
    const rows = await this.sql.many<{ id: string; t: Date }>(
      `SELECT c.id, coalesce(c.last_message_at, c.created_at) AS t FROM conversations c JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = $1
       WHERE ($2::timestamptz IS NULL OR (coalesce(c.last_message_at, c.created_at), c.id) < ($2, $3::uuid))
       ORDER BY t DESC, c.id DESC LIMIT $4`, [user.id, c?.t ?? null, c?.id ?? null, q.limit + 1]);
    const page = rows.slice(0, q.limit); const last = page[page.length - 1];
    return { data: await Promise.all(page.map((r) => this.conversation(user, r.id))), nextCursor: rows.length > q.limit && last ? cursor.encode({ t: last.t.toISOString(), id: last.id }) : null };
  }

  async messages(user: AuthUser, id: string, q: { cursor?: string; limit: number }) {
    await this.assertMember(id, user.id);
    const c = cursor.decode<{ t: string; id: string }>(q.cursor);
    const rows = await this.sql.many<MessageRow>(
      `SELECT * FROM messages WHERE conversation_id = $1 AND ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3::uuid))
       ORDER BY created_at DESC, id DESC LIMIT $4`, [id, c?.t ?? null, c?.id ?? null, q.limit + 1]);
    const page = rows.slice(0, q.limit); const last = page[page.length - 1];
    await this.markDelivered(user, id);
    return { data: page.map((m) => this.dto(m)), nextCursor: rows.length > q.limit && last ? cursor.encode({ t: last.created_at.toISOString(), id: last.id }) : null };
  }

  private async rate(userId: string) {
    const [m, h] = await Promise.all([this.redis.incr(`rl:msg:m:${userId}`), this.redis.incr(`rl:msg:h:${userId}`)]);
    if (m === 1) await this.redis.expire(`rl:msg:m:${userId}`, 60);
    if (h === 1) await this.redis.expire(`rl:msg:h:${userId}`, 3600);
    const r = messageRateOk(m - 1, h - 1, 0, false);
    if (!r.ok) throw AppError.tooMany(r.code, "You're sending messages too quickly", 30);
  }

  /** One send path for REST and WebSocket. Idempotent on (conversation, sender, clientId). */
  async send(user: AuthUser, id: string, d: { kind: "text" | "offer" | "image"; body?: string; offer?: { listingId?: string; quantity: string; pricePerUnit: string }; clientId?: string; payload?: Record<string, unknown> }) {
    await this.assertMember(id, user.id);
    const others = await this.otherMembers(id, user.id);
    for (const o of others) if (await this.market.blocked(user.id, o)) throw AppError.forbidden("blocked", "You can't message this user");
    if (d.clientId) {
      const dup = await this.sql.one<MessageRow>(`SELECT * FROM messages WHERE conversation_id = $1 AND sender_id = $2 AND client_id = $3`, [id, user.id, d.clientId]);
      if (dup) return this.dto(dup);
    }
    await this.rate(user.id);

    let body = d.body?.trim() ?? null;
    let payload: Record<string, unknown> = d.payload ?? {};
    if (d.kind === "text" && !body) throw AppError.unprocessable("body_required", "Message can't be empty");
    if (d.kind === "offer") {
      const conv = await this.sql.one<{ listing_id: string | null }>(`SELECT listing_id FROM conversations WHERE id = $1`, [id]);
      const listingId = d.offer?.listingId ?? conv?.listing_id;
      if (!d.offer || !listingId) throw AppError.unprocessable("offer_invalid", "An offer needs a listing, quantity and price");
      const offer = await this.market.createOffer(user, listingId, d.offer);
      payload = { offerId: offer.id, listingId, quantity: offer.quantity, pricePerUnit: offer.pricePerUnit };
      body = null;
    }
    const scan = body ? scanMessage(body) : { flags: [] as string[], action: "allow" as const, score: 0 };
    const flags = scan.action === "allow" ? [] : scan.flags.map((f) => `scam_${f}`);

    const m = await this.sql.tx(async (c) => {
      const row = (await c.query<MessageRow>(
        `INSERT INTO messages (conversation_id, sender_id, kind, body, payload, client_id, flags) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (conversation_id, sender_id, client_id) DO UPDATE SET client_id = EXCLUDED.client_id RETURNING *`,
        [id, user.id, d.kind, body, payload, d.clientId ?? null, flags])).rows[0]!;
      await c.query(`UPDATE conversations SET last_message_at = $2 WHERE id = $1`, [id, row.created_at]);
      if (scan.action !== "allow") {
        await c.query(`INSERT INTO moderation_items (target_type, target_id, reason, signals) VALUES ('message', $1, 'scam_pattern', $2)`, [row.id, { score: scan.score, flags: scan.flags }]);
      }
      return row;
    });

    const dto = this.dto(m);
    this.emit(`conv:${id}`, "message:new", dto);
    // Push fallback for recipients who aren't connected.
    for (const o of others) {
      if (!(await this.isOnline(o))) {
        await this.queue.dispatch({ userId: o, category: "market_update", templateKey: "message.new",
          params: { title: "New message", body: d.kind === "text" ? (body!.length > 80 ? `${body!.slice(0, 79)}…` : body!) : d.kind === "offer" ? "You received an offer" : "Sent you a photo" },
          channels: ["push"], data: { conversationId: id, messageId: m.id }, dedupeKey: `msg:${m.id}:${o}` });
      }
    }
    return dto;
  }

  async sendImage(user: AuthUser, id: string, file: Express.Multer.File | undefined, clientId?: string) {
    await this.assertMember(id, user.id);
    const img = await this.media.processImage(file, `messages/${id}`);
    return this.send(user, id, { kind: "image", clientId, payload: { variants: img.variants, width: img.width, height: img.height } });
  }

  async markRead(user: AuthUser, id: string) {
    await this.assertMember(id, user.id);
    const at = new Date();
    await this.sql.exec(`UPDATE conversation_members SET last_read_at = $3, last_delivered_at = greatest(coalesce(last_delivered_at, $3), $3) WHERE conversation_id = $1 AND user_id = $2`, [id, user.id, at]);
    this.emit(`conv:${id}`, "message:read", { conversationId: id, userId: user.id, at: at.toISOString() });
  }

  async markDelivered(user: AuthUser, id: string) {
    const at = new Date();
    await this.sql.exec(`UPDATE conversation_members SET last_delivered_at = $3 WHERE conversation_id = $1 AND user_id = $2`, [id, user.id, at]);
    this.emit(`conv:${id}`, "message:delivered", { conversationId: id, userId: user.id, at: at.toISOString() });
  }

  async block(user: AuthUser, target: string, on: boolean) {
    if (target === user.id) throw AppError.unprocessable("self_block", "You can't block yourself");
    if (on) await this.sql.exec(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [user.id, target]);
    else await this.sql.exec(`DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`, [user.id, target]);
  }

  /** Retention: per-country days (countries.config.messaging_retention_days, default 365). Run by the scheduler. */
  async purgeExpired(): Promise<number> {
    return this.sql.exec(
      `DELETE FROM messages m USING conversations c, countries co
       WHERE c.id = m.conversation_id AND co.iso2 = c.country_iso2
         AND m.created_at < now() - make_interval(days => coalesce((co.config->>'messaging_retention_days')::int, 365))
         AND NOT EXISTS (SELECT 1 FROM orders o JOIN disputes d ON d.order_id = o.id WHERE o.id = c.order_id AND d.status <> 'resolved')`);
  }
}
