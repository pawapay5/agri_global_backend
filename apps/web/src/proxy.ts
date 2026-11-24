import createIntlMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";
import { ACCESS_COOKIE, claims, needsRefresh, REFRESH_COOKIE, refreshTokens, setTokenCookies, STAFF_ROLES } from "./lib/auth/tokens";
import { clientIp } from "./lib/security/client-ip";
import { buildCsp, newNonce } from "./lib/security/csp";
import { csrfCookieName, newCsrfToken } from "./lib/security/csrf";
import { ipAllowed, parseAllowlist } from "./lib/security/ip-allowlist";
import { HTTPS_SITE } from "./lib/security/transport";

const intl = createIntlMiddleware(routing);
const API = (process.env.AGRIPRICE_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
const SECURE = HTTPS_SITE;
const ADMIN_ALLOW = parseAllowlist(process.env.ADMIN_IP_ALLOWLIST);
const PUBLIC_CSP = buildCsp({ https: HTTPS_SITE });

/**
 * 1) CSP: per-request nonce for /app and /admin (rendered per request); the cacheable policy elsewhere.
 * 2) Locale routing (next-intl).
 * 3) CSRF cookie issued to every page visit, so forms can echo it to the BFF.
 * 4) /admin: optional IP allow-list (404 outside it), then an optimistic role gate.
 * 5) Optimistic auth gate for /app and /admin with silent refresh. Layouts and the backend re-check
 *    authorisation on every request; this only saves a round trip.
 */
export async function proxy(req: NextRequest) {
  const [, locale, area] = req.nextUrl.pathname.split("/");
  const isPrivate = area === "app" || area === "admin";

  if (area === "admin" && !ipAllowed(clientIp(req.headers), ADMIN_ALLOW)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const nonce = isPrivate ? newNonce() : undefined;
  const csp = nonce ? buildCsp({ nonce, https: HTTPS_SITE }) : PUBLIC_CSP;
  const headers = new Headers(req.headers);
  if (nonce) { headers.set("content-security-policy", csp); headers.set("x-nonce", nonce); }
  const res = intl(new NextRequest(req, { headers }));
  res.headers.set("Content-Security-Policy", csp);

  const csrf = csrfCookieName(SECURE);
  if (!req.cookies.get(csrf)) {
    res.cookies.set(csrf, newCsrfToken(), { httpOnly: false, secure: SECURE, sameSite: "lax", path: "/" });
  }

  if (!isPrivate) return res;
  res.headers.set("Cache-Control", "private, no-store");

  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  let token = access;

  if (needsRefresh(access)) {
    const outcome = refresh ? await refreshTokens(API, refresh) : ({ kind: "failed" } as const);
    if (outcome.kind === "ok") {
      setTokenCookies(res.cookies, outcome.tokens);
      token = outcome.tokens.accessToken;
    } else if (outcome.kind === "race") {
      return res; // a concurrent request rotated the token; its response carries the new cookies
    } else if (needsRefresh(access, 0)) {
      // Refresh failed and the access token is missing or already expired: sign in again.
      const login = new URL(`/${locale}/login`, req.url);
      login.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
      return NextResponse.redirect(login);
    }
  }

  if (area === "admin" && !STAFF_ROLES.includes(claims(token)?.role as (typeof STAFF_ROLES)[number])) {
    return NextResponse.redirect(new URL(`/${locale}/app`, req.url));
  }
  return res;
}

export const config = {
  // Everything except API routes, Next internals and files with an extension.
  // The dot is double-escaped so the regex gets `\.` (a literal dot = "has a file extension").
  // A single backslash in a JS string is dropped, which made the lookahead exclude every path.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
