import "server-only";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { clientIp } from "../security/client-ip";
import { CSRF_HEADER, csrfCookieName, tokensMatch } from "../security/csrf";
import { AUTH_LIMITS, hit } from "../security/rate-limit";
import { HTTPS_SITE } from "../security/transport";
import { DEVICE_COOKIE } from "./tokens";

/**
 * Guards every state-changing BFF request: same Origin as our host, plus the double-submit CSRF token
 * (cookie issued by proxy.ts, echoed in X-CSRF-Token). Defence in depth on top of SameSite=Lax cookies.
 */
export async function assertSameOrigin(req: Request): Promise<NextResponse | null> {
  if (req.method === "GET" || req.method === "HEAD") return null;
  const h = await headers();
  const origin = req.headers.get("origin");
  // Behind a proxy (Coolify's Traefik, Cloudflare) the public host may arrive as X-Forwarded-Host. A browser never
  // lets a page forge its Origin, so accepting any of our own hosts keeps the check meaningful; CSRF token below.
  const ours = new Set([h.get("host"), h.get("x-forwarded-host")?.split(",")[0]?.trim(), siteHost()].filter(Boolean) as string[]);
  if (!origin) {
    console.warn(`[bff] 403 origin_required: no Origin header on ${req.method} ${new URL(req.url).pathname}`);
    return problem(403, "origin_required", "Forbidden");
  }
  let originHost = "";
  try { originHost = new URL(origin).host; } catch { /* malformed */ }
  if (!ours.has(originHost)) {
    console.warn(`[bff] 403 cross_site_request: Origin host "${originHost}" is not one of ours [${[...ours].join(", ")}]`);
    return problem(403, "cross_site_request", "Forbidden");
  }
  const cookie = (await cookies()).get(csrfCookieName(HTTPS_SITE))?.value;
  if (!tokensMatch(cookie, req.headers.get(CSRF_HEADER))) {
    console.warn(`[bff] 403 csrf_failed: ${cookie ? "token mismatch" : `no ${csrfCookieName(HTTPS_SITE)} cookie (is the site URL scheme right? cookies marked Secure are dropped on http://)`}`);
    return problem(403, "csrf_failed", "Forbidden");
  }
  return null;
}

/** Host of the configured public site URL (NEXT_PUBLIC_SITE_URL), if set. */
function siteHost(): string | null {
  try { return process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL).host : null; } catch { return null; }
}

/** Per-IP limit for an auth action; 429 problem with Retry-After when exceeded. */
export async function rateLimit(req: Request, action: string): Promise<NextResponse | null> {
  const limit = AUTH_LIMITS[action];
  const ip = clientIp(req.headers);
  if (!limit || !ip) return null;
  const v = await hit(limit, ip);
  if (v.ok) return null;
  const res = NextResponse.json(
    { type: "about:blank", status: 429, code: "rate_limited", title: "Too many requests", retryAfterSeconds: v.retryAfterSeconds },
    { status: 429, headers: { "Content-Type": "application/problem+json", "Retry-After": String(v.retryAfterSeconds) } },
  );
  return res;
}

/**
 * Headers that tell the backend who the real visitor is. The API trusts one proxy hop (`trust proxy 1`), and
 * for BFF calls that hop is us, so its per-IP throttles and audit logs see the visitor, not the web container.
 */
export function forwardedFor(req: Request): Record<string, string> {
  const ip = clientIp(req.headers);
  return ip ? { "X-Forwarded-For": ip } : {};
}

/** Stable per-browser installation id, so web sessions show up in the device list. */
export async function deviceInfo(userAgent: string | null) {
  const jar = await cookies();
  let id = jar.get(DEVICE_COOKIE)?.value;
  if (!id) {
    id = `web-${crypto.randomUUID()}`;
    jar.set(DEVICE_COOKIE, id, { httpOnly: true, secure: HTTPS_SITE, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 400 });
  }
  const ua = userAgent ?? "";
  const name = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return { installationId: id, platform: "web" as const, name: `${name} (web)` };
}

export function problem(status: number, code: string, title = "Error") {
  return NextResponse.json({ type: "about:blank", status, code, title }, { status, headers: { "Content-Type": "application/problem+json" } });
}

/**
 * One log line per API rejection the BFF relays, so 4xx answers (which the API doesn't log as errors) are visible
 * in the web container's logs: "[bff] POST /v1/auth/register → 422 country_unsupported". Only the method, path,
 * status and the problem's machine code are logged: never request bodies, emails, phone numbers or tokens.
 */
export function logRejected(method: string, path: string, status: number, body?: string | null) {
  let code = "";
  try { code = (JSON.parse(body ?? "") as { code?: string }).code ?? ""; } catch { /* not JSON */ }
  const line = `[bff] ${method} ${path.split("?")[0]} → ${status}${code ? ` ${code}` : ""}`;
  if (status >= 500) console.error(line); else console.warn(line);
}

/** Logs why the backend couldn't be reached (server terminal only) and returns the 502 problem for the client. */
export function upstreamUnavailable(url: string, err: unknown) {
  const cause = (err as { cause?: { code?: string } })?.cause?.code ?? (err as Error)?.message ?? String(err);
  console.error(`[bff] API unreachable at ${new URL(url).origin} (${cause}). Is the API running? Check AGRIPRICE_API_URL.`);
  return problem(502, "upstream_unavailable", "The AgriPrice API is unreachable");
}
