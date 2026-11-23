import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Logger, Module, OnApplicationBootstrap, Param, ParseUUIDPipe, Post, Put, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsIn, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, ValidateNested } from "class-validator";
import { Worker } from "bullmq";
import type Redis from "ioredis";
import { randomBytes } from "node:crypto";
import { AuthUser, CurrentUser } from "../../common/auth/auth.common";
import { AuditService } from "../../common/audit/audit.service";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { cursor } from "../../common/http/request-context";
import { QueueService } from "../../common/queue/queues";
import { REDIS } from "../../common/redis/redis.module";
import { PagedQuery, PRICE_TYPES, upperIso } from "../geo/geo.dto";
import { PricesModule } from "../prices/prices.module";
import { PricesService } from "../prices/prices.service";
import { MediaService } from "../uploads/media.service";
import { GeoPointDto } from "../users/users.dto";
import { isoWeek, moderateText, parseMentions, rankFeed, REPUTATION } from "./community.logic";

class PriceDto {
  @Matches(/^\d{1,12}(\.\d{1,4})?$/) amount: string;
  @Matches(/^[A-Z]{3}$/) currency: string;
  @IsString() @MaxLength(32) unit: string;
  @IsOptional() @IsIn(PRICE_TYPES) priceType?: string;
}
class PostCreateDto {
  @IsIn(["price_update", "market_news", "tip", "question"]) type: "price_update" | "market_news" | "tip" | "question";
  @IsString() @Length(1, 5000) body: string;
  @IsOptional() @IsUUID() commodityId?: string;
  @IsOptional() @IsUUID() marketId?: string;
  @IsOptional() @ValidateNested() @Type(() => PriceDto) price?: PriceDto;
  @IsOptional() @ValidateNested() @Type(() => GeoPointDto) location?: GeoPointDto;
}
class FeedQuery extends PagedQuery {
  @IsOptional() @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country?: string;
  @IsOptional() @IsIn(["price_update", "market_news", "tip", "question"]) type?: string;
  @IsOptional() @IsUUID() commodity_id?: string;
  @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
}
class CommentDto { @IsString() @Length(1, 2000) body: string; @IsOptional() @IsUUID() parentId?: string }
class ReactDto { @IsIn(["like", "helpful", "insightful"]) type: string }
class AcceptDto { @IsUUID() commentId: string }

const FEED_POOL = 300; // candidates ranked per page window

@Injectable()
export class CommunityService {
  private readonly log = new Logger(CommunityService.name);
  constructor(
    private readonly sql: Sql, private readonly prices: PricesService, private readonly media: MediaService, private readonly queue: QueueService, private readonly audit: AuditService,
  ) {}

  async rep(userId: string, kind: keyof typeof REPUTATION | string, refId: string | null) {
    await this.sql.exec(`INSERT INTO reputation_events (user_id, kind, points, ref_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [userId, kind, REPUTATION[kind] ?? 0, refId]);
  }

  private async postDto(p: Record<string, any>, viewerId: string) {
    const [author, my, obs] = await Promise.all([
      this.sql.one<{ id: string; name: string | null; rep: number; badges: string[] }>(
        `SELECT u.id, u.full_name AS name, coalesce((SELECT sum(points) FROM reputation_events WHERE user_id = u.id), 0)::int AS rep,
                coalesce((SELECT array_agg(DISTINCT badge_code) FROM user_badges WHERE user_id = u.id), '{}') AS badges FROM users u WHERE u.id = $1`, [p.author_id]),
      this.sql.one<{ type: string }>(`SELECT type FROM reactions WHERE post_id = $1 AND user_id = $2`, [p.id, viewerId]),
      p.price_observation_id ? this.sql.one<{ status: string }>(`SELECT status FROM price_observations WHERE id = $1`, [p.price_observation_id]) : Promise.resolve(undefined),
    ]);
    return {
      id: p.id, author: { id: author?.id, name: author?.name ?? null, reputation: author?.rep ?? 0, badges: author?.badges ?? [] }, type: p.type, body: p.body,
      commodityId: p.commodity_id, marketId: p.market_id, price: p.price, priceObservationStatus: obs?.status ?? null,
      photos: (p.photos as Record<string, string>[]).map((v, i) => ({ id: `${p.id}:${i}`, position: i, urls: this.media.urls(v) })),
      status: p.status, acceptedCommentId: p.accepted_comment_id, counts: { comments: p.comment_count, reactions: p.reaction_count, shares: p.share_count },
      myReaction: my?.type ?? null, createdAt: p.created_at.toISOString(),
    };
  }

  async create(user: AuthUser, d: PostCreateDto) {
    const mod = moderateText(d.body);
    if (mod.verdict === "block") throw AppError.unprocessable("content_rejected", "This post breaks the community guidelines");
    let regionId: string | null = null, obsId: string | null = null;
    if (d.type === "price_update") {
      if (!d.commodityId || !d.marketId || !d.price) throw AppError.unprocessable("price_details_required", "A price update needs the commodity, market and price");
      const m = await this.sql.one<{ region_id: string | null }>(`SELECT region_id FROM markets WHERE id = $1`, [d.marketId]);
      if (!m) throw AppError.unprocessable("market_unknown", "Market not found");
      regionId = m.region_id;
      // Same ingestion path as every price: validated, normalised, MAD-scored. Crowd prices go to review.
      const obs = await this.prices.submit({
        commodityId: d.commodityId, marketId: d.marketId, priceType: d.price.priceType ?? "retail", amount: d.price.amount, currency: d.price.currency,
        unit: d.price.unit, observedAt: new Date().toISOString(), location: d.location, note: d.body.slice(0, 500),
      }, user, `post:${randomBytes(8).toString("hex")}`, {}, { ip: null, userAgent: null, requestId: null, installationId: null });
      obsId = obs.id;
    } else if (d.marketId) {
      regionId = (await this.sql.one<{ region_id: string | null }>(`SELECT region_id FROM markets WHERE id = $1`, [d.marketId]))?.region_id ?? null;
    }
    const p = await this.sql.one(
      `INSERT INTO posts (author_id, country_iso2, type, body, commodity_id, market_id, region_id, location, price, price_observation_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $8::float8 IS NULL THEN (SELECT location FROM markets WHERE id = $6) ELSE ST_SetSRID(ST_MakePoint($9,$8),4326)::geography END, $10, $11, $12)
       RETURNING *`,
      [user.id, user.country, d.type, d.body, d.commodityId ?? null, d.marketId ?? null, regionId, d.location?.lat ?? null, d.location?.lng ?? null,
        d.price ? JSON.stringify(d.price) : null, obsId, mod.verdict === "review" ? "pending_review" : "visible"]);
    if (mod.verdict === "review") await this.sql.exec(`INSERT INTO moderation_items (target_type, target_id, reason, signals) VALUES ('post', $1, 'auto_text', $2)`, [p!.id, { reasons: mod.reasons }]);
    await this.rep(user.id, "post_created", p!.id);
    await this.notifyMentions(user, d.body, p!.id);
    return this.postDto(p!, user.id);
  }

  private async notifyMentions(user: AuthUser, text: string, postId: string) {
    const names = parseMentions(text);
    if (!names.length) return;
    // Mentions match the seller display name or first-name handle (lower-cased, spaces removed).
    const targets = await this.sql.many<{ id: string }>(
      `SELECT u.id FROM users u LEFT JOIN seller_profiles sp ON sp.user_id = u.id
       WHERE u.country_iso2 = $2 AND u.id <> $3 AND (lower(replace(coalesce(sp.display_name, ''), ' ', '')) = ANY($1) OR lower(replace(coalesce(u.full_name, ''), ' ', '')) = ANY($1)) LIMIT 10`,
      [names, user.country, user.id]);
    for (const t of targets) {
      await this.queue.dispatch({ userId: t.id, category: "market_update", templateKey: "community.mention", params: { title: "You were mentioned", body: text.slice(0, 120) }, data: { postId }, dedupeKey: `mention:${postId}:${t.id}` });
    }
  }

  async feed(user: AuthUser, q: FeedQuery) {
    const country = q.country ?? user.country;
    // Rank a recency-bounded pool, then page through it with an offset cursor (pool is re-ranked per request window).
    const off = cursor.decode<{ o: number }>(q.cursor)?.o ?? 0;
    const pool = await this.sql.many<Record<string, any>>(
      `SELECT p.*, CASE WHEN $3::float8 IS NULL OR p.location IS NULL THEN NULL ELSE ST_Distance(p.location, ST_SetSRID(ST_MakePoint($4,$3),4326)::geography) / 1000 END AS distance_km
       FROM posts p JOIN users u ON u.id = p.author_id
       WHERE p.country_iso2 = $1 AND p.status = 'visible' AND u.suspended_at IS NULL AND p.created_at > now() - interval '30 days'
         AND ($2::text IS NULL OR p.type = $2) AND ($5::uuid IS NULL OR p.commodity_id = $5)
         AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = $6 AND b.blocked_id = p.author_id) OR (b.blocker_id = p.author_id AND b.blocked_id = $6))
       ORDER BY p.created_at DESC LIMIT $7`, [country, q.type ?? null, q.lat ?? null, q.lng ?? null, q.commodity_id ?? null, user.id, FEED_POOL]);
    const following = new Set((await this.sql.many<{ followee_id: string }>(`SELECT followee_id FROM follows WHERE follower_id = $1`, [user.id])).map((r) => r.followee_id));
    const ranked = rankFeed(pool.map((p) => ({ ...p, id: p.id as string, type: p.type as string, createdAt: p.created_at as Date, authorId: p.author_id as string, reactions: p.reaction_count, comments: p.comment_count, shares: p.share_count,
      distanceKm: p.distance_km as number | null, acceptedAnswer: Boolean(p.accepted_comment_id) })), following);
    const page = ranked.slice(off, off + q.limit);
    return { data: await Promise.all(page.map((p) => this.postDto(p, user.id))), nextCursor: off + q.limit < ranked.length ? cursor.encode({ o: off + q.limit }) : null };
  }

  async get(user: AuthUser, id: string) {
    const p = await this.sql.one(`SELECT * FROM posts WHERE id = $1`, [id]);
    if (!p || (p.status !== "visible" && p.author_id !== user.id && user.role !== "admin")) throw AppError.notFound("post");
    return this.postDto(p, user.id);
  }

  async remove(user: AuthUser, id: string) {
    const n = await this.sql.exec(`UPDATE posts SET status = 'removed' WHERE id = $1 AND (author_id = $2 OR $3)`, [id, user.id, user.role === "admin"]);
    if (!n) throw AppError.notFound("post");
  }

  async addPhoto(user: AuthUser, id: string, file: Express.Multer.File | undefined) {
    const p = await this.sql.one<{ author_id: string; photos: unknown[] }>(`SELECT author_id, photos FROM posts WHERE id = $1`, [id]);
    if (!p || p.author_id !== user.id) throw AppError.notFound("post");
    if (p.photos.length >= 4) throw AppError.unprocessable("photo_limit", "A post can have up to 4 photos");
    const img = await this.media.processImage(file, `posts/${id}`);
    await this.sql.exec(`UPDATE posts SET photos = photos || $2::jsonb WHERE id = $1`, [id, JSON.stringify([img.variants])]);
    return { id: `${id}:${p.photos.length}`, position: p.photos.length, width: img.width, height: img.height, urls: this.media.urls(img.variants) };
  }

  async comments(user: AuthUser, postId: string) {
    const post = await this.get(user, postId);
    const rows = await this.sql.many<{ id: string; parent_id: string | null; author_id: string; name: string | null; body: string; created_at: Date }>(
      `SELECT c.id, c.parent_id, c.author_id, u.full_name AS name, c.body, c.created_at FROM comments c JOIN users u ON u.id = c.author_id
       WHERE c.post_id = $1 AND c.status = 'visible' ORDER BY c.created_at`, [postId]);
    const byId = new Map<string, any>();
    for (const r of rows) byId.set(r.id, { id: r.id, postId, parentId: r.parent_id, author: { id: r.author_id, name: r.name }, body: r.body, accepted: r.id === post.acceptedCommentId, replies: [], createdAt: r.created_at.toISOString() });
    const roots: any[] = [];
    for (const c of byId.values()) (c.parentId && byId.get(c.parentId) ? byId.get(c.parentId).replies : roots).push(c);
    return roots.sort((a, b) => Number(b.accepted) - Number(a.accepted));
  }

  async comment(user: AuthUser, postId: string, d: CommentDto) {
    const post = await this.sql.one<{ author_id: string; status: string }>(`SELECT author_id, status FROM posts WHERE id = $1`, [postId]);
    if (!post || post.status !== "visible") throw AppError.notFound("post");
    const mod = moderateText(d.body);
    if (mod.verdict === "block") throw AppError.unprocessable("content_rejected", "This comment breaks the community guidelines");
    if (d.parentId && !(await this.sql.one(`SELECT 1 FROM comments WHERE id = $1 AND post_id = $2`, [d.parentId, postId]))) throw AppError.unprocessable("parent_invalid", "Reply target not found");
    const c = await this.sql.tx(async (tx) => {
      const r = (await tx.query<{ id: string; created_at: Date }>(`INSERT INTO comments (post_id, author_id, parent_id, body, status) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
        [postId, user.id, d.parentId ?? null, d.body, mod.verdict === "review" ? "hidden" : "visible"])).rows[0]!;
      await tx.query(`UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1`, [postId]);
      return r;
    });
    if (mod.verdict === "review") await this.sql.exec(`INSERT INTO moderation_items (target_type, target_id, reason, signals) VALUES ('comment', $1, 'auto_text', $2)`, [c.id, { reasons: mod.reasons }]);
    await this.rep(user.id, "comment_created", c.id);
    if (post.author_id !== user.id) await this.queue.dispatch({ userId: post.author_id, category: "market_update", templateKey: "community.comment", params: { title: "New comment", body: d.body.slice(0, 120) }, data: { postId }, dedupeKey: `comment:${c.id}` });
    await this.notifyMentions(user, d.body, postId);
    return { id: c.id, postId, parentId: d.parentId ?? null, author: { id: user.id, name: null }, body: d.body, accepted: false, replies: [], createdAt: c.created_at.toISOString() };
  }

  async react(user: AuthUser, postId: string, type: string | null) {
    const post = await this.sql.one<{ author_id: string }>(`SELECT author_id FROM posts WHERE id = $1 AND status = 'visible'`, [postId]);
    if (!post) throw AppError.notFound("post");
    await this.sql.tx(async (c) => {
      if (type) {
        const r = await c.query(`INSERT INTO reactions (post_id, user_id, type) VALUES ($1,$2,$3) ON CONFLICT (post_id, user_id) DO UPDATE SET type = EXCLUDED.type RETURNING (xmax = 0) AS inserted`, [postId, user.id, type]);
        if ((r.rows[0] as { inserted: boolean }).inserted) await c.query(`UPDATE posts SET reaction_count = reaction_count + 1 WHERE id = $1`, [postId]);
      } else {
        const r = await c.query(`DELETE FROM reactions WHERE post_id = $1 AND user_id = $2`, [postId, user.id]);
        if (r.rowCount) await c.query(`UPDATE posts SET reaction_count = greatest(reaction_count - 1, 0) WHERE id = $1`, [postId]);
      }
    });
    if (type && post.author_id !== user.id) await this.sql.exec(`INSERT INTO reputation_events (user_id, kind, points, ref_id) VALUES ($1,'reaction_received',1,$2) ON CONFLICT DO NOTHING`, [post.author_id, `${postId}`.slice(0, 36)]).catch(() => undefined);
  }

  async share(user: AuthUser, postId: string) {
    await this.get(user, postId);
    await this.sql.exec(`UPDATE posts SET share_count = share_count + 1 WHERE id = $1`, [postId]);
    const code = randomBytes(6).toString("base64url").replace(/[-_]/g, "x").slice(0, 8);
    await this.sql.exec(`INSERT INTO short_links (code, target_type, target_id, created_by) VALUES ($1,'post',$2,$3)`, [code, postId, user.id]);
    return { url: `${process.env.API_PUBLIC_URL ?? "https://api.agriprice.app"}/s/${code}` };
  }

  async acceptAnswer(user: AuthUser, postId: string, commentId: string) {
    const post = await this.sql.one<{ author_id: string; type: string }>(`SELECT author_id, type FROM posts WHERE id = $1`, [postId]);
    if (!post || post.author_id !== user.id) throw AppError.notFound("post");
    if (post.type !== "question") throw AppError.unprocessable("not_a_question", "Only questions have accepted answers");
    const c = await this.sql.one<{ author_id: string }>(`SELECT author_id FROM comments WHERE id = $1 AND post_id = $2 AND status = 'visible'`, [commentId, postId]);
    if (!c) throw AppError.notFound("comment");
    await this.sql.exec(`UPDATE posts SET accepted_comment_id = $2 WHERE id = $1`, [postId, commentId]);
    if (c.author_id !== user.id) await this.rep(c.author_id, "answer_accepted", commentId);
  }

  async follow(user: AuthUser, id: string, on: boolean) {
    if (id === user.id) throw AppError.unprocessable("self_follow", "You can't follow yourself");
    if (on) {
      const n = await this.sql.exec(`INSERT INTO follows (follower_id, followee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [user.id, id]);
      if (n) await this.queue.dispatch({ userId: id, category: "market_update", templateKey: "community.follow", params: { title: "New follower", body: "Someone started following you." }, dedupeKey: `follow:${user.id}:${id}` });
    } else await this.sql.exec(`DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2`, [user.id, id]);
  }

  async profile(viewer: AuthUser, id: string) {
    const u = await this.sql.one<{ id: string; full_name: string | null; role: string }>(`SELECT id, full_name, role FROM users WHERE id = $1 AND deletion_scheduled_at IS NULL`, [id]);
    if (!u) throw AppError.notFound("user");
    const s = await this.sql.one<{ rep: number; followers: number; following: number; posts: number; prices: number; is_following: boolean }>(
      `SELECT coalesce((SELECT sum(points) FROM reputation_events WHERE user_id = $1), 0)::int AS rep,
              (SELECT count(*) FROM follows WHERE followee_id = $1)::int AS followers, (SELECT count(*) FROM follows WHERE follower_id = $1)::int AS following,
              (SELECT count(*) FROM posts WHERE author_id = $1 AND status = 'visible')::int AS posts,
              (SELECT count(*) FROM price_observations WHERE submitted_by = $1 AND status = 'approved')::int AS prices,
              EXISTS (SELECT 1 FROM follows WHERE follower_id = $2 AND followee_id = $1) AS is_following`, [id, viewer.id]);
    const badges = await this.sql.many<{ badge_code: string; name: Record<string, string>; period: string }>(
      `SELECT ub.badge_code, b.name, ub.period FROM user_badges ub JOIN badges b ON b.code = ub.badge_code WHERE ub.user_id = $1 ORDER BY ub.awarded_at DESC LIMIT 20`, [id]);
    return { id, name: u.full_name, role: u.role, reputation: s!.rep, followers: s!.followers, following: s!.following, isFollowing: s!.is_following, posts: s!.posts,
      approvedPriceReports: s!.prices, badges: badges.map((b) => ({ code: b.badge_code, name: b.name.en ?? b.badge_code, period: b.period })) };
  }

  /** Weekly: top contributor per country (badge), threshold badges, and reputation for newly approved crowd prices. */
  async weeklyJobs() {
    const week = isoWeek(new Date(Date.now() - 86_400_000));
    await this.sql.exec(
      `INSERT INTO reputation_events (user_id, kind, points, ref_id)
       SELECT submitted_by, 'price_approved', $1, id FROM price_observations
       WHERE status = 'approved' AND submitted_by IS NOT NULL AND source = 'crowd' AND coalesce(reviewed_at, created_at) > now() - interval '8 days'
       ON CONFLICT DO NOTHING`, [REPUTATION.price_approved]);
    await this.sql.exec(
      `INSERT INTO user_badges (user_id, badge_code, period)
       SELECT DISTINCT ON (u.country_iso2) r.user_id, 'weekly_top_contributor', $1
       FROM reputation_events r JOIN users u ON u.id = r.user_id
       WHERE r.created_at > now() - interval '7 days' AND u.suspended_at IS NULL
       GROUP BY u.country_iso2, r.user_id HAVING sum(r.points) > 0
       ORDER BY u.country_iso2, sum(r.points) DESC
       ON CONFLICT DO NOTHING`, [week]);
    await this.sql.exec(`INSERT INTO user_badges (user_id, badge_code) SELECT user_id, 'trusted_reporter' FROM reputation_events WHERE kind = 'price_approved' GROUP BY user_id HAVING count(*) >= 25 ON CONFLICT DO NOTHING`);
    await this.sql.exec(`INSERT INTO user_badges (user_id, badge_code) SELECT user_id, 'helpful_answerer' FROM reputation_events WHERE kind = 'answer_accepted' GROUP BY user_id HAVING count(*) >= 10 ON CONFLICT DO NOTHING`);
    // Seller response time: median minutes to first reply in conversations from the last 30 days.
    await this.sql.exec(
      `UPDATE seller_profiles sp SET response_time_mins = t.mins FROM (
         SELECT seller, percentile_cont(0.5) WITHIN GROUP (ORDER BY mins)::int AS mins FROM (
           SELECT l.seller_id AS seller, extract(epoch FROM (min(r.created_at) - min(q.created_at))) / 60 AS mins
           FROM conversations c JOIN listings l ON l.id = c.listing_id
           JOIN messages q ON q.conversation_id = c.id AND q.sender_id <> l.seller_id
           JOIN messages r ON r.conversation_id = c.id AND r.sender_id = l.seller_id AND r.created_at > q.created_at
           WHERE c.created_at > now() - interval '30 days' GROUP BY c.id, l.seller_id) x GROUP BY seller) t
       WHERE sp.user_id = t.seller`);
  }
}

@ApiTags("community")
@ApiBearerAuth()
@Controller("v1/community")
export class CommunityController {
  constructor(private readonly c: CommunityService) {}

  @Get("feed") @ApiOperation({ operationId: "community_feed" })
  feed(@CurrentUser() u: AuthUser, @Query() q: FeedQuery) { return this.c.feed(u, q); }

  @Post("posts") @ApiOperation({ operationId: "community_posts_create" })
  create(@CurrentUser() u: AuthUser, @Body() d: PostCreateDto) { return this.c.create(u, d); }

  @Get("posts/:id") @ApiOperation({ operationId: "community_posts_get" })
  get(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { return this.c.get(u, id); }

  @Delete("posts/:id") @HttpCode(204) @ApiOperation({ operationId: "community_posts_delete" })
  async remove(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { await this.c.remove(u, id); }

  @Post("posts/:id/photos") @ApiOperation({ operationId: "community_post_photo_upload" }) @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  photo(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @UploadedFile() f?: Express.Multer.File) { return this.c.addPhoto(u, id, f); }

  @Get("posts/:id/comments") @ApiOperation({ operationId: "community_comments_list" })
  comments(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { return this.c.comments(u, id); }

  @Post("posts/:id/comments") @ApiOperation({ operationId: "community_comments_create" })
  comment(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() d: CommentDto) { return this.c.comment(u, id, d); }

  @Put("posts/:id/reaction") @HttpCode(204) @ApiOperation({ operationId: "community_react" })
  async react(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() d: ReactDto) { await this.c.react(u, id, d.type); }

  @Delete("posts/:id/reaction") @HttpCode(204) @ApiOperation({ operationId: "community_unreact" })
  async unreact(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { await this.c.react(u, id, null); }

  @Post("posts/:id/share") @HttpCode(200) @ApiOperation({ operationId: "community_share" })
  share(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { return this.c.share(u, id); }

  @Post("posts/:id/accept-answer") @HttpCode(204) @ApiOperation({ operationId: "community_accept_answer" })
  async accept(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() d: AcceptDto) { await this.c.acceptAnswer(u, id, d.commentId); }

  @Get("users/:id") @ApiOperation({ operationId: "community_profile" })
  profile(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { return this.c.profile(u, id); }

  @Post("users/:id/follow") @HttpCode(204) @ApiOperation({ operationId: "community_follow" })
  async follow(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { await this.c.follow(u, id, true); }

  @Delete("users/:id/follow") @HttpCode(204) @ApiOperation({ operationId: "community_unfollow" })
  async unfollow(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { await this.c.follow(u, id, false); }
}

@Injectable()
export class CommunityScheduler implements OnApplicationBootstrap {
  constructor(private readonly c: CommunityService, private readonly queue: QueueService, @Inject(REDIS) private readonly redis: Redis) {}
  async onApplicationBootstrap() {
    if (process.env.RUN_SCHEDULERS !== "true") return;
    await this.queue.queue("community").upsertJobScheduler("weekly", { pattern: "0 1 * * 1" }, { name: "weekly" });
    new Worker("community", async (j) => (j.name === "weekly" ? this.c.weeklyJobs() : undefined), { connection: this.redis.duplicate() });
  }
}

@Module({ imports: [PricesModule], controllers: [CommunityController], providers: [CommunityService, CommunityScheduler] })
export class CommunityModule {}
