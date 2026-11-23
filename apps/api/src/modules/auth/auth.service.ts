import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import type Redis from "ioredis";
import { APP_CONFIG, AppConfig } from "../../config/config";
import { AuthUser, TokenService } from "../../common/auth/auth.common";
import { AuditService } from "../../common/audit/audit.service";
import { FieldCipher } from "../../common/crypto/crypto";
import { DRIZZLE, Db } from "../../common/db/database.module";
import { consents, devices, recoveryCodes, UserRow, userPreferences } from "../../common/db/schema";
import { AppError } from "../../common/http/problem";
import type { ClientMeta } from "../../common/http/request-context";
import { QueueService } from "../../common/queue/queues";
import { REDIS } from "../../common/redis/redis.module";
import { toUserDto, UsersRepository } from "../users/users.repository";
import {
  generateRecoveryCodes, hashPassword, hashRecoveryCode, needsRehash, passwordProblem, totp, verifyPassword,
} from "./credentials";
import type {
  ChangePasswordDto, DeviceInfoDto, DeviceUpdateDto, LoginDto, MfaVerifyDto, OAuthDto, OtpRequestDto, OtpVerifyDto, RegisterDto, ResetPasswordDto,
} from "./auth.dto";
import { OAuthService } from "./oauth.service";
import { OtpService } from "./otp.service";
import { SessionService, TokenPair } from "./session.service";

const LOGIN_FAIL_LIMIT = 10;
const LOGIN_FAIL_WINDOW = 15 * 60;

export interface AuthResult {
  status: "authenticated" | "mfa_required" | "verification_required";
  tokens?: TokenPair;
  mfaToken?: string;
  user?: ReturnType<typeof toUserDto>;
  isNewUser?: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly sessions: SessionService,
    private readonly otp: OtpService,
    private readonly oauth: OAuthService,
    private readonly tokens: TokenService,
    private readonly cipher: FieldCipher,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  // ── helpers ──
  private async signIn(u: UserRow, device: DeviceInfoDto | undefined, client: ClientMeta, isNewUser = false): Promise<AuthResult> {
    if (u.deletionScheduledAt) {
      // Signing in during the grace period cancels deletion. That is the documented recovery path.
      u = await this.usersRepo.update(u.id, { deletionScheduledAt: null, deletionRequestedAt: null });
      await this.audit.record({ actorId: u.id, action: "account.deletion.cancelled_by_login" }, client);
    }
    const deviceId = await this.sessions.upsertDevice(u.id, device, client);
    const tokens = await this.sessions.start(u, deviceId, client);
    await this.usersRepo.update(u.id, { lastLoginAt: new Date() });
    await this.audit.record({ actorId: u.id, action: "auth.login.succeeded", data: { deviceId, isNewUser } }, client);
    return { status: "authenticated", tokens, user: toUserDto(u), isNewUser };
  }

  private async afterFirstFactor(u: UserRow, device: DeviceInfoDto | undefined, client: ClientMeta, isNewUser = false): Promise<AuthResult> {
    if (u.totpEnabledAt) {
      return { status: "mfa_required", mfaToken: await this.tokens.signMfa(u.id, device?.installationId) };
    }
    return this.signIn(u, device, client, isNewUser);
  }

  private async sendOtp(channel: "sms" | "email", destination: string, purpose: OtpRequestDto["purpose"], locale: string) {
    const issued = await this.otp.issue(purpose, channel, destination);
    await this.queue.sendOtp({ channel, destination, code: issued.code, purpose, locale });
    return { expiresInSeconds: issued.expiresInSeconds, resendAfterSeconds: issued.resendAfterSeconds };
  }

  private failKey = (email: string) => `auth:fail:${email.toLowerCase()}`;

  // ── email + password ──
  async register(dto: RegisterDto, client: ClientMeta): Promise<AuthResult> {
    const problem = passwordProblem(dto.password, dto.email);
    if (problem) throw AppError.unprocessable("password_weak", problem);
    const u = await this.usersRepo.create({
      email: dto.email.toLowerCase(), passwordHash: await hashPassword(dto.password), fullName: dto.fullName,
      countryIso2: dto.country, role: dto.role ?? "farmer", passwordChangedAt: new Date(),
    });
    await this.db.insert(consents).values([
      { userId: u.id, type: "terms", granted: true, version: "1.0", ip: client.ip, userAgent: client.userAgent },
      { userId: u.id, type: "privacy", granted: true, version: "1.0", ip: client.ip, userAgent: client.userAgent },
    ]);
    if (dto.locale) await this.db.insert(userPreferences).values({ userId: u.id, locale: dto.locale }).onConflictDoNothing();
    await this.audit.record({ actorId: u.id, action: "auth.register", data: { method: "password" } }, client);
    await this.sendOtp("email", u.email!, "verify_email", dto.locale ?? "en").catch(() => undefined);
    return this.signIn(u, dto.device, client, true);
  }

  async login(dto: LoginDto, client: ClientMeta): Promise<AuthResult> {
    const fails = Number(await this.redis.get(this.failKey(dto.email)));
    if (fails >= LOGIN_FAIL_LIMIT) throw AppError.tooMany("login_locked", "Too many failed sign-in attempts. Try again in 15 minutes or reset your password.", LOGIN_FAIL_WINDOW);

    const u = await this.usersRepo.byEmail(dto.email);
    const ok = await verifyPassword(u?.passwordHash ?? null, dto.password);
    if (!u || !ok) {
      const n = await this.redis.incr(this.failKey(dto.email));
      if (n === 1) await this.redis.expire(this.failKey(dto.email), LOGIN_FAIL_WINDOW);
      await this.audit.record({ actorId: u?.id ?? null, action: "auth.login.failed", data: { method: "password" } }, client);
      throw AppError.unauthorized("invalid_credentials", "Email or password is incorrect");
    }
    await this.redis.del(this.failKey(dto.email));
    if (needsRehash(u.passwordHash!)) await this.usersRepo.update(u.id, { passwordHash: await hashPassword(dto.password) });
    return this.afterFirstFactor(u, dto.device, client);
  }

  // ── OTP ──
  async requestOtp(dto: OtpRequestDto) {
    if (dto.purpose === "reset_password") throw AppError.badRequest("use_forgot_password");
    return this.sendOtp(dto.channel, dto.destination, dto.purpose, dto.locale ?? "en");
  }

  async verifyOtp(dto: OtpVerifyDto, client: ClientMeta, current: AuthUser | null): Promise<AuthResult> {
    const dest = await this.otp.verify(dto.purpose, dto.channel, dto.destination, dto.code);

    if (dto.purpose === "verify_email" || dto.purpose === "verify_phone") {
      if (!current) throw AppError.unauthorized("token_missing", "Sign in to verify contact details");
      const patch = dto.channel === "email" ? { email: dest, emailVerifiedAt: new Date() } : { phone: dest, phoneVerifiedAt: new Date() };
      const u = await this.usersRepo.update(current.id, patch).catch((e) => {
        if ((e as { code?: string }).code === "23505") throw AppError.conflict("contact_in_use", "This contact is linked to another account");
        throw e;
      });
      await this.audit.record({ actorId: u.id, action: `auth.${dto.purpose}` }, client);
      return { status: "authenticated", user: toUserDto(u) };
    }

    // purpose=login: passwordless sign-in / sign-up.
    let u = dto.channel === "sms" ? await this.usersRepo.byPhone(dest) : await this.usersRepo.byEmail(dest);
    let isNew = false;
    if (!u) {
      const country = dto.country ?? (dto.channel === "sms" ? await this.usersRepo.countryForPhone(dest) : null);
      if (!country) throw AppError.unprocessable("country_required", "Select your country to create an account");
      u = await this.usersRepo.create({
        countryIso2: country,
        ...(dto.channel === "sms" ? { phone: dest, phoneVerifiedAt: new Date() } : { email: dest, emailVerifiedAt: new Date() }),
      });
      isNew = true;
      await this.audit.record({ actorId: u.id, action: "auth.register", data: { method: `otp_${dto.channel}` } }, client);
    } else if (dto.channel === "sms" && !u.phoneVerifiedAt) {
      u = await this.usersRepo.update(u.id, { phoneVerifiedAt: new Date() });
    } else if (dto.channel === "email" && !u.emailVerifiedAt) {
      u = await this.usersRepo.update(u.id, { emailVerifiedAt: new Date() });
    }
    return this.afterFirstFactor(u, dto.device, client, isNew);
  }

  // ── OAuth ──
  async oauthSignIn(provider: string, dto: OAuthDto, client: ClientMeta): Promise<AuthResult> {
    const p = await this.oauth.verify(provider, dto.token, dto.nonce);
    let u = await this.usersRepo.byOAuth(p.provider, p.subject);
    let isNew = false;
    if (!u && p.email && p.emailVerified) {
      // Link only to an account whose email is itself verified, to block pre-registration takeover.
      const existing = await this.usersRepo.byEmail(p.email);
      if (existing?.emailVerifiedAt) u = existing;
      else if (existing) throw AppError.conflict("account_exists_unverified", "Sign in with your password and verify your email first");
    }
    if (!u) {
      if (!dto.country) throw AppError.unprocessable("country_required", "Select your country to create an account");
      u = await this.usersRepo.create({
        countryIso2: dto.country, email: p.emailVerified ? p.email?.toLowerCase() : null,
        emailVerifiedAt: p.emailVerified ? new Date() : null, fullName: p.name ?? dto.fullName ?? null,
      });
      isNew = true;
      await this.audit.record({ actorId: u.id, action: "auth.register", data: { method: `oauth_${provider}` } }, client);
    }
    await this.usersRepo.linkOAuth(u.id, p.provider, p.subject, p.email);
    return this.afterFirstFactor(u, dto.device, client, isNew);
  }

  // ── MFA ──
  async verifyMfa(dto: MfaVerifyDto, client: ClientMeta): Promise<AuthResult> {
    const userId = await this.tokens.verifyMfa(dto.mfaToken);
    const key = `auth:mfa_fail:${userId}`;
    if (Number(await this.redis.get(key)) >= 5) throw AppError.tooMany("mfa_locked", "Too many attempts. Sign in again later.", 900);
    const u = await this.usersRepo.mustGet(userId);
    if (!u.totpSecretEnc) throw AppError.badRequest("mfa_not_enabled");

    let ok = /^\d{6}$/.test(dto.code) && totp.check(dto.code, this.cipher.decrypt(u.totpSecretEnc));
    if (!ok && !/^\d{6}$/.test(dto.code)) {
      const h = hashRecoveryCode(this.cfg.otpPepper, dto.code);
      const used = await this.db.update(recoveryCodes).set({ usedAt: new Date() })
        .where(and(eq(recoveryCodes.userId, u.id), eq(recoveryCodes.codeHash, h), isNull(recoveryCodes.usedAt))).returning({ id: recoveryCodes.id });
      ok = used.length > 0;
      if (ok) await this.audit.record({ actorId: u.id, action: "auth.mfa.recovery_code_used" }, client);
    }
    if (!ok) {
      if ((await this.redis.incr(key)) === 1) await this.redis.expire(key, 900);
      throw AppError.unauthorized("mfa_code_invalid");
    }
    await this.redis.del(key);
    return this.signIn(u, dto.device, client);
  }

  async totpSetup(user: AuthUser) {
    const u = await this.usersRepo.mustGet(user.id);
    if (u.totpEnabledAt) throw AppError.conflict("totp_already_enabled");
    const secret = totp.secret();
    await this.usersRepo.update(u.id, { totpPendingEnc: this.cipher.encrypt(secret) });
    return { secret, otpauthUrl: totp.url(u.email ?? u.phone ?? u.id, secret) };
  }

  async totpEnable(user: AuthUser, code: string, client: ClientMeta) {
    const u = await this.usersRepo.mustGet(user.id);
    if (!u.totpPendingEnc) throw AppError.badRequest("totp_setup_required");
    const secret = this.cipher.decrypt(u.totpPendingEnc);
    if (!totp.check(code, secret)) throw AppError.badRequest("totp_code_invalid");
    const codes = generateRecoveryCodes();
    await this.db.transaction(async (tx) => {
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, u.id));
      await tx.insert(recoveryCodes).values(codes.map((c) => ({ userId: u.id, codeHash: hashRecoveryCode(this.cfg.otpPepper, c) })));
    });
    await this.usersRepo.update(u.id, { totpSecretEnc: u.totpPendingEnc, totpPendingEnc: null, totpEnabledAt: new Date() });
    await this.audit.record({ actorId: u.id, action: "auth.totp.enabled" }, client);
    return { recoveryCodes: codes };
  }

  async totpDisable(user: AuthUser, code: string, client: ClientMeta) {
    const u = await this.usersRepo.mustGet(user.id);
    if (!u.totpSecretEnc) throw AppError.badRequest("totp_not_enabled");
    if (!totp.check(code, this.cipher.decrypt(u.totpSecretEnc))) throw AppError.badRequest("totp_code_invalid");
    await this.usersRepo.update(u.id, { totpSecretEnc: null, totpEnabledAt: null });
    await this.db.delete(recoveryCodes).where(eq(recoveryCodes.userId, u.id));
    await this.audit.record({ actorId: u.id, action: "auth.totp.disabled" }, client);
  }

  // ── passwords ──
  async forgotPassword(email: string) {
    const u = await this.usersRepo.byEmail(email);
    // Always 202. Only actually send when the account exists (prevents enumeration).
    if (u?.email) await this.sendOtp("email", u.email, "reset_password", "en").catch(() => undefined);
  }

  async resetPassword(dto: ResetPasswordDto, client: ClientMeta) {
    await this.otp.verify("reset_password", "email", dto.email, dto.code);
    const u = await this.usersRepo.byEmail(dto.email);
    if (!u) throw AppError.badRequest("otp_invalid");
    const problem = passwordProblem(dto.newPassword, u.email);
    if (problem) throw AppError.unprocessable("password_weak", problem);
    await this.usersRepo.update(u.id, { passwordHash: await hashPassword(dto.newPassword), passwordChangedAt: new Date(), emailVerifiedAt: u.emailVerifiedAt ?? new Date() });
    await this.sessions.revokeAll(u.id, "password_reset");
    await this.redis.del(this.failKey(dto.email));
    await this.audit.record({ actorId: u.id, action: "auth.password.reset" }, client);
  }

  async changePassword(user: AuthUser, dto: ChangePasswordDto, client: ClientMeta) {
    const u = await this.usersRepo.mustGet(user.id);
    if (u.passwordHash && !(await verifyPassword(u.passwordHash, dto.currentPassword))) throw AppError.unauthorized("invalid_credentials");
    const problem = passwordProblem(dto.newPassword, u.email);
    if (problem) throw AppError.unprocessable("password_weak", problem);
    await this.usersRepo.update(u.id, { passwordHash: await hashPassword(dto.newPassword), passwordChangedAt: new Date() });
    // Keep the current device signed in; end every other session.
    const current = user.deviceId
      ? await this.db.query.refreshTokens.findFirst({ where: (t, { eq: e, and: a, isNull: n }) => a(e(t.deviceId, user.deviceId!), n(t.revokedAt)), orderBy: (t) => desc(t.createdAt) })
      : undefined;
    await this.sessions.revokeAll(u.id, "password_changed", current?.familyId);
    await this.audit.record({ actorId: u.id, action: "auth.password.changed" }, client);
  }

  // ── devices ──
  async listDevices(user: AuthUser) {
    const rows = await this.db.select().from(devices).where(and(eq(devices.userId, user.id), isNull(devices.revokedAt))).orderBy(desc(devices.lastSeenAt));
    return rows.map((d) => ({
      id: d.id, platform: d.platform, name: d.name, appVersion: d.appVersion, hasPushToken: Boolean(d.pushToken),
      lastSeenAt: d.lastSeenAt.toISOString(), lastIp: d.lastIp, createdAt: d.createdAt.toISOString(), current: d.id === user.deviceId,
    }));
  }

  async updateCurrentDevice(user: AuthUser, dto: DeviceUpdateDto) {
    if (!user.deviceId) throw AppError.badRequest("no_device", "This session is not bound to a device");
    await this.db.update(devices).set({
      ...(dto.pushToken !== undefined ? { pushToken: dto.pushToken } : {}),
      ...(dto.name ? { name: dto.name } : {}),
      ...(dto.appVersion ? { appVersion: dto.appVersion } : {}),
      lastSeenAt: new Date(),
    }).where(and(eq(devices.id, user.deviceId), eq(devices.userId, user.id)));
    return (await this.listDevices(user)).find((d) => d.id === user.deviceId)!;
  }
}
