import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Logger, Module, OnApplicationBootstrap, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { createAdapter } from "@socket.io/redis-adapter";
import { Type } from "class-transformer";
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateNested, validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import type Redis from "ioredis";
import type { Server, Socket } from "socket.io";
import { Worker } from "bullmq";
import { AuthUser, CurrentUser, revokedBeforeKey, TokenService } from "../../common/auth/auth.common";
import { AuditService } from "../../common/audit/audit.service";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { QueueService } from "../../common/queue/queues";
import { REDIS } from "../../common/redis/redis.module";
import { PagedQuery } from "../geo/geo.dto";
import { MarketplaceModule } from "../marketplace/marketplace.module";
import { MessagingService } from "./messaging.service";

class ConversationCreateDto { @IsUUID() userId: string; @IsOptional() @IsUUID() listingId?: string; @IsOptional() @IsUUID() orderId?: string }
class OfferPart { @IsOptional() @IsUUID() listingId?: string; @IsString() @MaxLength(20) quantity: string; @IsString() @MaxLength(20) pricePerUnit: string }
class MessageSendDto {
  @IsIn(["text", "offer"]) kind: "text" | "offer";
  @IsOptional() @IsString() @MaxLength(4000) body?: string;
  @IsOptional() @ValidateNested() @Type(() => OfferPart) offer?: OfferPart;
  @IsOptional() @IsString() @MaxLength(64) clientId?: string;
}
class WsSendDto extends MessageSendDto { @IsUUID() conversationId: string }
class ImageDto { @IsOptional() @IsString() @MaxLength(64) clientId?: string }
class AbuseReportDto {
  @IsIn(["listing", "message", "post", "comment", "user", "price"]) targetType: string;
  @IsUUID() targetId: string;
  @IsIn(["scam", "spam", "harassment", "inappropriate", "wrong_price", "counterfeit", "other"]) reason: string;
  @IsOptional() @IsString() @MaxLength(2000) details?: string;
}

@ApiTags("messaging")
@ApiBearerAuth()
@Controller("v1")
export class MessagingController {
  constructor(private readonly m: MessagingService, private readonly sql: Sql, private readonly audit: AuditService) {}

  @Get("conversations") @ApiOperation({ operationId: "messaging_conversations_list" })
  list(@CurrentUser() u: AuthUser, @Query() q: PagedQuery) { return this.m.list(u, q); }

  @Post("conversations") @HttpCode(200) @ApiOperation({ operationId: "messaging_conversations_create" })
  open(@CurrentUser() u: AuthUser, @Body() d: ConversationCreateDto) { return this.m.open(u, d); }

  @Get("conversations/:id/messages") @ApiOperation({ operationId: "messaging_messages_list" })
  messages(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Query() q: PagedQuery) { return this.m.messages(u, id, q); }

  @Post("conversations/:id/messages") @ApiOperation({ operationId: "messaging_messages_send" })
  send(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() d: MessageSendDto) { return this.m.send(u, id, d); }

  @Post("conversations/:id/read") @HttpCode(204) @ApiOperation({ operationId: "messaging_mark_read" })
  async read(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { await this.m.markRead(u, id); }

  @Post("conversations/:id/images") @ApiOperation({ operationId: "messaging_image_upload" }) @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  image(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() d: ImageDto, @UploadedFile() f?: Express.Multer.File) { return this.m.sendImage(u, id, f, d.clientId); }

  @Post("users/:id/block") @HttpCode(204) @ApiOperation({ operationId: "messaging_block" })
  async block(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { await this.m.block(u, id, true); }

  @Delete("users/:id/block") @HttpCode(204) @ApiOperation({ operationId: "messaging_unblock" })
  async unblock(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { await this.m.block(u, id, false); }

  @Post("moderation/reports") @HttpCode(202) @ApiOperation({ operationId: "moderation_report" })
  async report(@CurrentUser() u: AuthUser, @Body() d: AbuseReportDto) {
    const n = await this.sql.exec(
      `INSERT INTO moderation_items (target_type, target_id, reporter_id, reason, details) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (target_type, target_id, reporter_id) WHERE reporter_id IS NOT NULL DO NOTHING`, [d.targetType, d.targetId, u.id, d.reason, d.details ?? null]);
    // Auto-hide content once 3 distinct users report it; a moderator then confirms or restores it.
    const count = (await this.sql.one<{ n: number }>(`SELECT count(DISTINCT reporter_id)::int AS n FROM moderation_items WHERE target_type = $1 AND target_id = $2 AND status = 'open'`, [d.targetType, d.targetId]))?.n ?? 0;
    if (count >= 3) {
      if (d.targetType === "post") await this.sql.exec(`UPDATE posts SET status = 'pending_review' WHERE id = $1 AND status = 'visible'`, [d.targetId]);
      if (d.targetType === "comment") await this.sql.exec(`UPDATE comments SET status = 'hidden' WHERE id = $1 AND status = 'visible'`, [d.targetId]);
    }
    if (n) await this.audit.record({ actorId: u.id, action: "moderation.reported", entity: d.targetType, entityId: d.targetId, data: { reason: d.reason } });
  }
}

/** Socket.IO gateway at /v1/realtime. JWT in the handshake; the Redis adapter fans out across API replicas. */
@WebSocketGateway({ namespace: "/v1/realtime", cors: { origin: (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(","), credentials: false } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly log = new Logger("realtime");
  private typingAt = new Map<string, number>();
  constructor(private readonly tokens: TokenService, private readonly m: MessagingService, @Inject(REDIS) private readonly redis: Redis) {}

  afterInit(nsp: Server) {
    const io = (nsp as unknown as { server: Server }).server ?? nsp;
    io.adapter(createAdapter(this.redis.duplicate(), this.redis.duplicate()));
    this.m.emit = (room, event, data) => this.server.to(room).emit(event, data);
  }

  private user(s: Socket): AuthUser { return s.data.user as AuthUser; }

  async handleConnection(s: Socket) {
    try {
      const token = (s.handshake.auth?.token as string | undefined) ?? s.handshake.headers.authorization?.replace(/^Bearer /, "");
      if (!token) throw new Error("no token");
      const u = await this.tokens.verifyAccess(token);
      const revokedBefore = Number(await this.redis.get(revokedBeforeKey(u.id)));
      if (revokedBefore && u.iat < revokedBefore) throw new Error("revoked");
      s.data.user = { id: u.id, role: u.role, country: u.country, deviceId: u.deviceId, orgId: u.orgId };
      // Access tokens last 15 min: disconnect when this one expires so the client reconnects with a fresh token.
      const exp = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()).exp as number;
      setTimeout(() => s.disconnect(true), Math.max(0, exp * 1000 - Date.now()));
      await s.join(`user:${u.id}`);
      const convs = await this.m.memberConversations(u.id);
      for (const c of convs) await s.join(`conv:${c.conversation_id}`);
      const n = await this.redis.incr(`presence:conn:${u.id}`);
      await this.redis.set(`presence:${u.id}`, "1", "EX", 120);
      if (n === 1) this.broadcastPresence(u.id, convs.map((c) => c.conversation_id), true);
      s.on("ping:presence", () => this.redis.set(`presence:${u.id}`, "1", "EX", 120));
    } catch {
      s.emit("error", { code: "unauthorized" });
      s.disconnect(true);
    }
  }

  async handleDisconnect(s: Socket) {
    const u = s.data.user as AuthUser | undefined;
    if (!u) return;
    const n = await this.redis.decr(`presence:conn:${u.id}`);
    if (n <= 0) {
      await this.redis.del(`presence:${u.id}`, `presence:conn:${u.id}`);
      await this.redis.set(`presence:last:${u.id}`, new Date().toISOString(), "EX", 30 * 86_400);
      const rooms = [...s.rooms].filter((r) => r.startsWith("conv:")).map((r) => r.slice(5));
      this.broadcastPresence(u.id, rooms, false);
    }
  }

  private broadcastPresence(userId: string, convs: string[], online: boolean) {
    for (const c of convs) this.server.to(`conv:${c}`).emit("presence", { userId, online, lastSeenAt: online ? null : new Date().toISOString() });
  }

  private async wrap<T>(fn: () => Promise<T>) {
    try { return { ok: true, data: await fn() }; }
    catch (e) { return { ok: false, error: e instanceof AppError ? { code: e.code, detail: e.detail } : { code: "internal_error" } }; }
  }

  @SubscribeMessage("message:send")
  async onSend(s: Socket, body: unknown) {
    return this.wrap(async () => {
      const d = plainToInstance(WsSendDto, body);
      const errs = await validate(d, { whitelist: true, forbidNonWhitelisted: true });
      if (errs.length) throw AppError.unprocessable("validation_failed", errs.map((e) => e.property).join(", "));
      return this.m.send(this.user(s), d.conversationId, d);
    });
  }

  @SubscribeMessage("message:read")
  async onRead(s: Socket, body: { conversationId?: string }) {
    return this.wrap(() => this.m.markRead(this.user(s), String(body?.conversationId)));
  }

  @SubscribeMessage("conversation:join")
  async onJoin(s: Socket, body: { conversationId?: string }) {
    return this.wrap(async () => { await this.m.assertMember(String(body?.conversationId), this.user(s).id); await s.join(`conv:${body.conversationId}`); });
  }

  @SubscribeMessage("typing")
  async onTyping(s: Socket, body: { conversationId?: string; typing?: boolean }) {
    const u = this.user(s); const id = String(body?.conversationId);
    const key = `${u.id}:${id}`; const last = this.typingAt.get(key) ?? 0;
    if (Date.now() - last < 2000 || !s.rooms.has(`conv:${id}`)) return;
    this.typingAt.set(key, Date.now());
    s.to(`conv:${id}`).emit("typing", { conversationId: id, userId: u.id, typing: Boolean(body?.typing) });
  }
}

/** Daily retention purge, run by the scheduler deployment. */
@Injectable()
export class MessagingRetention implements OnApplicationBootstrap {
  constructor(private readonly m: MessagingService, private readonly queue: QueueService, @Inject(REDIS) private readonly redis: Redis) {}
  async onApplicationBootstrap() {
    if (process.env.RUN_SCHEDULERS !== "true") return;
    await this.queue.queue("messaging").upsertJobScheduler("retention", { pattern: "0 3 * * *" }, { name: "retention" });
    new Worker("messaging", async (j) => (j.name === "retention" ? this.m.purgeExpired() : undefined), { connection: this.redis.duplicate() });
  }
}

@Module({ imports: [MarketplaceModule], controllers: [MessagingController], providers: [MessagingService, RealtimeGateway, MessagingRetention], exports: [MessagingService] })
export class MessagingModule {}
