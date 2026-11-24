/**
 * Token cookie handling, shared by proxy.ts and the BFF route handlers.
 * Tokens live only in httpOnly cookies: browser JavaScript never sees them.
 * Claims are decoded (not verified) only for routing hints; the backend verifies every request.
 */
import { decodeJwt } from "jose";
import { HTTPS_SITE } from "../security/transport";

export const ACCESS_COOKIE = "ap_at";
export const REFRESH_COOKIE = "ap_rt";
export const MFA_COOKIE = "ap_mfa";
export const DEVICE_COOKIE = "ap_did";

export interface TokenPair { accessToken: string; accessTokenExpiresAt: string; refreshToken: string; refreshTokenExpiresAt: string }
export interface Claims { sub: string; role: string; cty: string; exp: number }

type CookieSetter = { set: (name: string, value: string, opts: Record<string, unknown>) => unknown; delete: (name: string) => unknown };

// Secure only when the site is on HTTPS: browsers drop Secure cookies on http:// sites (see security/transport).
const base = () => ({ httpOnly: true, secure: HTTPS_SITE, sameSite: "lax" as const, path: "/" });

export function setTokenCookies(c: CookieSetter, t: TokenPair) {
  c.set(ACCESS_COOKIE, t.accessToken, { ...base(), expires: new Date(t.accessTokenExpiresAt) });
  c.set(REFRESH_COOKIE, t.refreshToken, { ...base(), expires: new Date(t.refreshTokenExpiresAt) });
}

export function clearTokenCookies(c: CookieSetter) {
  for (const n of [ACCESS_COOKIE, REFRESH_COOKIE, MFA_COOKIE]) c.delete(n);
}

export function setMfaCookie(c: CookieSetter, token: string) {
  c.set(MFA_COOKIE, token, { ...base(), maxAge: 300 });
}

export function claims(token: string | undefined): Claims | null {
  if (!token) return null;
  try {
    const c = decodeJwt(token) as Partial<Claims>;
    return c.sub && c.exp ? (c as Claims) : null;
  } catch {
    return null;
  }
}

/** True if the token is missing or expires within `skewSeconds`. */
export function needsRefresh(token: string | undefined, skewSeconds = 60, now = Date.now()): boolean {
  const c = claims(token);
  return !c || c.exp * 1000 - now < skewSeconds * 1000;
}

export type RefreshOutcome = { kind: "ok"; tokens: TokenPair } | { kind: "race" } | { kind: "failed" };

/** Rotates the refresh token. A concurrent rotation ("refresh_race") is not a logout: the winner's cookies arrive with its response. */
export async function refreshTokens(apiUrl: string, refreshToken: string): Promise<RefreshOutcome> {
  try {
    const res = await fetch(`${apiUrl}/v1/auth/refresh`, {
      signal: upstreamSignal(),
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken }), cache: "no-store",
    });
    if (res.ok) return { kind: "ok", tokens: (await res.json()) as TokenPair };
    const p = (await res.json().catch(() => ({}))) as { code?: string };
    return p.code === "refresh_race" ? { kind: "race" } : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

export const STAFF_ROLES = ["admin", "org_admin", "enumerator", "agronomist"] as const;

/**
 * Abort signal for server→API calls made on behalf of a browser request (BFF, proxy refresh, admin gate).
 * API_TIMEOUT_MS, default 10 s: a half-up API must fail the request, not hang it. Uploads/exports that
 * legitimately take longer go through the passthrough, which uses API_LONG_TIMEOUT_MS (default 60 s).
 */
export const upstreamSignal = (long = false) =>
  AbortSignal.timeout(Number(long ? process.env.API_LONG_TIMEOUT_MS ?? 60_000 : process.env.API_TIMEOUT_MS ?? 10_000));
