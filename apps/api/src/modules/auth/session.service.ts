import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, sql as dsql } from "drizzle-orm";
import type Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { APP_CONFIG, AppConfig } from "../../config/config";
import { AuthUser, revokedBeforeKey, RoleName, TokenService } from "../../common/auth/auth.common";
import { randomToken, sha256 } from "../../common/crypto/crypto";
import { DRIZZLE, Db } from "../../common/db/database.module";
import { devices, refreshTokens, RefreshTokenRow, UserRow } from "../../common/db/schema";
import { AppError } from "../../common/http/problem";
import type { ClientMeta } from "../../common/http/request-context";
import { REDIS } from "../../common/redis/redis.module";
import { AuditService } from "../../common/audit/audit.service";
import type { DeviceInfoDto } from "./auth.dto";

export interface TokenPair { tokenType: "Bearer"; accessToken: string; accessTokenExpiresAt: string; refreshToken: string; refreshTokenExpiresAt: string }

export type RefreshVerdict = "ok" | "race" | "reuse" | "revoked" | "expired";

/** Concurrent refreshes (e.g. two tabs, or a prefetch plus a navigation through the web BFF) present the same token within seconds. */
export const REFRESH_RACE_GRACE_MS = 30_000;

/** Pure decision for a presented refresh token. */
export function classifyRefresh(row: Pick<RefreshTokenRow, "usedAt" | "revokedAt" | "expiresAt">, now = new Date()): RefreshVerdict {
  if (row.usedAt) {
    // Just rotated by a concurrent request: not theft. The caller should pick up the cookie the winner set.
    if (!row.revokedAt && now.getTime() - row.usedAt.getTime() < REFRESH_RACE_GRACE_MS) return "race";
    return "reuse";                        // replay of an old token: revoke the family
  }
  if (row.revokedAt) return "revoked";
  if (row.expiresAt <= now) return "expired";
  return "ok";
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async upsertDevice(userId: string, info: DeviceInfoDto | undefined, client: ClientMeta): Promise<string | null> {
    const installationId = info?.installationId ?? client.installationId;
    if (!installationId) return null;
    const [row] = await this.db
      .insert(devices)
      .values({
        userId, installationId, platform: info?.platform ?? "web", name: info?.name, appVersion: info?.appVersion,
        pushToken: info?.pushToken, lastIp: client.ip, userAgent: client.userAgent,
      })
      .onConflictDoUpdate({
        target: [devices.userId, devices.installationId],
        set: {
          platform: info?.platform ?? dsql`${devices.platform}`,
          name: info?.name ?? dsql`${devices.name}`,
          appVersion: info?.appVersion ?? dsql`${devices.appVersion}`,
          pushToken: info?.pushToken ?? dsql`${devices.pushToken}`,
          lastIp: client.ip, userAgent: client.userAgent, lastSeenAt: new Date(), revokedAt: null,
        },
      })
      .returning({ id: devices.id });
    return row!.id;
  }

  private authUser(u: Pick<UserRow, "id" | "role" | "countryIso2" | "organisationId">, deviceId: string | null): AuthUser {
    return { id: u.id, role: u.role as RoleName, country: u.countryIso2, deviceId, orgId: u.organisationId };
  }

  /** Starts a new session (new refresh-token family) for a user/device. */
  async start(u: Pick<UserRow, "id" | "role" | "countryIso2" | "organisationId">, deviceId: string | null, client: ClientMeta): Promise<TokenPair> {
    return this.issue(u, deviceId, randomUUID(), null, client);
  }

  private async issue(
    u: Pick<UserRow, "id" | "role" | "countryIso2" | "organisationId">, deviceId: string | null, familyId: string, parentId: string | null, client: ClientMeta,
  ): Promise<TokenPair> {
    const refresh = randomToken(32);
    const expiresAt = new Date(Date.now() + this.cfg.jwt.refreshTtlDays * 86_400_000);
    await this.db.insert(refreshTokens).values({
      userId: u.id, deviceId, familyId, parentId, tokenHash: sha256(refresh), expiresAt, ip: client.ip, userAgent: client.userAgent,
    });
    const access = await this.tokens.signAccess(this.authUser(u, deviceId));
    return {
      tokenType: "Bearer",
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: refresh,
      refreshTokenExpiresAt: expiresAt.toISOString(),
    };
  }

  /** Rotates a refresh token. Reuse of a rotated token revokes the entire family. */
  async rotate(presented: string, client: ClientMeta, loadUser: (id: string) => Promise<UserRow | undefined>): Promise<TokenPair> {
    const row = await this.db.query.refreshTokens.findFirst({ where: eq(refreshTokens.tokenHash, sha256(presented)) });
    if (!row) throw AppError.unauthorized("refresh_invalid");

    const verdict = classifyRefresh(row);
    if (verdict === "reuse") {
      await this.revokeFamily(row.familyId, "reuse_detected");
      await this.audit.record({ actorId: row.userId, action: "auth.refresh.reuse_detected", entity: "refresh_family", entityId: row.familyId }, client);
      throw AppError.unauthorized("refresh_reused", "Session ended for your security. Please sign in again.");
    }
    if (verdict === "race") throw AppError.unauthorized("refresh_race", "Token was just rotated by a concurrent request; retry with the latest token.");
    if (verdict !== "ok") throw AppError.unauthorized(`refresh_${verdict}`);

    // Atomic single-use claim: only one concurrent caller can win.
    const claimed = await this.db.update(refreshTokens).set({ usedAt: new Date() })
      .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.usedAt), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    if (!claimed.length) throw AppError.unauthorized("refresh_race", "Token was just rotated by a concurrent request; retry with the latest token.");

    const user = await loadUser(row.userId);
    if (!user || user.deletionScheduledAt) throw AppError.unauthorized("account_unavailable");
    if (row.deviceId) await this.db.update(devices).set({ lastSeenAt: new Date(), lastIp: client.ip }).where(eq(devices.id, row.deviceId));
    return this.issue(user, row.deviceId, row.familyId, row.id, client);
  }

  async revokeFamily(familyId: string, reason: string) {
    await this.db.update(refreshTokens).set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  async logout(presented: string, userId: string) {
    const row = await this.db.query.refreshTokens.findFirst({ where: eq(refreshTokens.tokenHash, sha256(presented)) });
    if (row && row.userId === userId) await this.revokeFamily(row.familyId, "logout");
  }

  async revokeDevice(userId: string, deviceId: string) {
    const updated = await this.db.update(devices).set({ revokedAt: new Date(), pushToken: null })
      .where(and(eq(devices.id, deviceId), eq(devices.userId, userId))).returning({ id: devices.id });
    if (!updated.length) throw AppError.notFound("device");
    await this.db.update(refreshTokens).set({ revokedAt: new Date(), revokedReason: "device_revoked" })
      .where(and(eq(refreshTokens.deviceId, deviceId), isNull(refreshTokens.revokedAt)));
  }

  /** Logout everywhere: kill refresh tokens and invalidate outstanding access tokens. */
  async revokeAll(userId: string, reason: string, exceptFamilyId?: string) {
    await this.db.update(refreshTokens).set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt),
        exceptFamilyId ? dsql`${refreshTokens.familyId} <> ${exceptFamilyId}` : undefined));
    if (!exceptFamilyId) {
      await this.redis.set(revokedBeforeKey(userId), String(Math.floor(Date.now() / 1000) + 1), "EX", this.cfg.jwt.accessTtlSeconds + 60);
    }
  }
}
