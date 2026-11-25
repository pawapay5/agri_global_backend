import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { assertSameOrigin, deviceInfo, forwardedFor, logRejected, problem, rateLimit, upstreamUnavailable } from "@/lib/auth/bff";
import { ACCESS_COOKIE, clearTokenCookies, MFA_COOKIE, REFRESH_COOKIE, refreshTokens, setMfaCookie, setTokenCookies, type TokenPair, upstreamSignal } from "@/lib/auth/tokens";
import { env } from "@/lib/env";

/** Which backend endpoint each BFF action maps to, and whether the body carries device info. */
const ACTIONS: Record<string, { path: string; device?: boolean }> = {
  login: { path: "/v1/auth/login", device: true },
  register: { path: "/v1/auth/register", device: true },
  "otp-request": { path: "/v1/auth/otp/request" },
  "otp-verify": { path: "/v1/auth/otp/verify", device: true },
  mfa: { path: "/v1/auth/mfa/verify", device: true },
  forgot: { path: "/v1/auth/password/forgot" },
  reset: { path: "/v1/auth/password/reset" },
};

interface AuthResult { status: string; tokens?: TokenPair; mfaToken?: string; user?: unknown; isNewUser?: boolean }

export async function POST(req: Request, ctx: RouteContext<"/api/auth/[action]">) {
  const { action } = await ctx.params;
  const blocked = await assertSameOrigin(req);
  if (blocked) return blocked;
  const jar = await cookies();

  if (action === "logout") {
    const rt = jar.get(REFRESH_COOKIE)?.value, at = jar.get(ACCESS_COOKIE)?.value;
    if (rt && at) {
      await fetch(`${env.apiUrl}/v1/auth/logout`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${at}`, ...forwardedFor(req) }, body: JSON.stringify({ refreshToken: rt }), signal: upstreamSignal() }).catch(() => undefined);
    }
    clearTokenCookies(jar);
    return new NextResponse(null, { status: 204 });
  }

  if (action === "logout-all") {
    // Ends every session on every device, then this browser's cookies. Needs a live session.
    const at = jar.get(ACCESS_COOKIE)?.value;
    if (!at) return problem(401, "no_session", "Unauthorized");
    const r = await fetch(`${env.apiUrl}/v1/auth/logout-all`, { method: "POST", headers: { Authorization: `Bearer ${at}`, ...forwardedFor(req) }, signal: upstreamSignal() }).catch((e: unknown) => e as Error);
    if (r instanceof Error) return upstreamUnavailable(env.apiUrl, r);
    if (!r.ok && r.status !== 401) return new NextResponse(await r.text(), { status: r.status, headers: { "Content-Type": "application/problem+json" } });
    clearTokenCookies(jar);
    return new NextResponse(null, { status: 204 });
  }

  if (action === "refresh") {
    const rt = jar.get(REFRESH_COOKIE)?.value;
    if (!rt) return problem(401, "no_session", "Unauthorized");
    const r = await refreshTokens(env.apiUrl, rt);
    if (r.kind === "ok") { setTokenCookies(jar, r.tokens); return new NextResponse(null, { status: 204 }); }
    if (r.kind === "race") return new NextResponse(null, { status: 204 });
    clearTokenCookies(jar);
    return problem(401, "session_expired", "Unauthorized");
  }

  const spec = ACTIONS[action];
  if (!spec) return problem(404, "not_found", "Not found");
  const limited = await rateLimit(req, action);
  if (limited) return limited;

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return problem(400, "invalid_json", "Bad request"); }
  if (spec.device) body.device = await deviceInfo(req.headers.get("user-agent"));
  if (action === "mfa") {
    // The MFA token never touches browser JavaScript: it sits in an httpOnly cookie between steps.
    body.mfaToken = jar.get(MFA_COOKIE)?.value;
    if (!body.mfaToken) return problem(401, "mfa_session_expired", "Unauthorized");
  }

  const upstream = await fetch(`${env.apiUrl}${spec.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept-Language": req.headers.get("accept-language") ?? "en", ...forwardedFor(req), ...(jar.get(ACCESS_COOKIE) ? { Authorization: `Bearer ${jar.get(ACCESS_COOKIE)!.value}` } : {}) },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: upstreamSignal(),
  }).catch((e: unknown) => e as Error);
  if (upstream instanceof Error) return upstreamUnavailable(env.apiUrl, upstream);

  const text = await upstream.text();
  if (!upstream.ok) logRejected("POST", spec.path, upstream.status, text);
  if (!upstream.ok || !text) return new NextResponse(text || null, { status: upstream.status, headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" } });

  const data = JSON.parse(text) as AuthResult;
  if (data.tokens) setTokenCookies(jar, data.tokens);
  if (data.mfaToken) setMfaCookie(jar, data.mfaToken);
  if (data.status === "authenticated") jar.delete(MFA_COOKIE);
  // Strip secrets before anything reaches the browser.
  return NextResponse.json({ status: data.status, user: data.user, isNewUser: data.isNewUser }, { status: upstream.status });
}
