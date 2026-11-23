import {
  CanActivate, createParamDecorator, ExecutionContext, Global, Inject, Injectable, Module, SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import Redis from "ioredis";
import { jwtVerify, SignJWT } from "jose";
import { APP_CONFIG, AppConfig } from "../../config/config";
import { AppError } from "../http/problem";
import { REDIS } from "../redis/redis.module";

export type RoleName =
  | "farmer" | "trader" | "consumer" | "researcher" | "student" | "policymaker" | "enumerator" | "admin" | "org_admin";

export interface AuthUser { id: string; role: RoleName; country: string; deviceId: string | null; orgId: string | null }

const IS_PUBLIC = "auth:public";
const ROLES = "auth:roles";
/** Endpoint needs no token. A valid token, if sent, is still decoded (for personalised display). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const u = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>().user;
  if (!u) throw AppError.unauthorized();
  return u;
});
export const OptionalUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser | null => ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>().user ?? null,
);

export const revokedBeforeKey = (userId: string) => `auth:revoked_before:${userId}`;

@Injectable()
export class TokenService {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async signAccess(u: AuthUser): Promise<{ token: string; expiresAt: Date }> {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.cfg.jwt.accessTtlSeconds;
    const token = await new SignJWT({ role: u.role, cty: u.country, sid: u.deviceId, org: u.orgId })
      .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
      .setSubject(u.id)
      .setIssuer(this.cfg.jwt.issuer)
      .setAudience("agriprice-api")
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(this.cfg.jwt.accessSecret);
    return { token, expiresAt: new Date(exp * 1000) };
  }

  /** Short-lived token proving password step passed, used to complete TOTP. */
  async signMfa(userId: string, deviceInstallationId?: string): Promise<string> {
    return new SignJWT({ typ: "mfa", ins: deviceInstallationId })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId).setIssuer(this.cfg.jwt.issuer).setAudience("agriprice-mfa")
      .setIssuedAt().setExpirationTime("5m")
      .sign(this.cfg.jwt.accessSecret);
  }

  async verifyMfa(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.cfg.jwt.accessSecret, { issuer: this.cfg.jwt.issuer, audience: "agriprice-mfa" });
      if (payload.typ !== "mfa" || !payload.sub) throw new Error("bad");
      return payload.sub;
    } catch {
      throw AppError.unauthorized("mfa_token_invalid", "MFA session expired. Sign in again.");
    }
  }

  async verifyAccess(token: string): Promise<AuthUser & { iat: number }> {
    const { payload } = await jwtVerify(token, this.cfg.jwt.accessSecret, {
      issuer: this.cfg.jwt.issuer, audience: "agriprice-api", algorithms: ["HS256"], typ: "at+jwt",
    });
    return {
      id: payload.sub!,
      role: payload.role as RoleName,
      country: payload.cty as string,
      deviceId: (payload.sid as string | null) ?? null,
      orgId: (payload.org as string | null) ?? null,
      iat: payload.iat ?? 0,
    };
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

    if (!token) {
      if (isPublic) return true;
      throw AppError.unauthorized("token_missing");
    }
    try {
      const u = await this.tokens.verifyAccess(token);
      // "logout everywhere" / password change: tokens issued before this instant are dead.
      const revokedBefore = Number(await this.redis.get(revokedBeforeKey(u.id)));
      if (revokedBefore && u.iat < revokedBefore) throw new Error("revoked");
      req.user = { id: u.id, role: u.role, country: u.country, deviceId: u.deviceId, orgId: u.orgId };
      return true;
    } catch {
      if (isPublic) return true; // fall back to anonymous on public routes
      throw AppError.unauthorized("token_invalid");
    }
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<RoleName[]>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (!roles?.length) return true;
    const u = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>().user;
    if (!u) throw AppError.unauthorized();
    if (!roles.includes(u.role)) throw AppError.forbidden("insufficient_role");
    return true;
  }
}

@Global()
@Module({ providers: [TokenService, JwtAuthGuard, RolesGuard], exports: [TokenService, JwtAuthGuard, RolesGuard] })
export class AuthCommonModule {}
