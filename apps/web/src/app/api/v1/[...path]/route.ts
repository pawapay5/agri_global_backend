import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { assertSameOrigin, forwardedFor, logRejected, problem, upstreamUnavailable } from "@/lib/auth/bff";
import { clientIp } from "@/lib/security/client-ip";
import { ipAllowed, parseAllowlist } from "@/lib/security/ip-allowlist";
import { ACCESS_COOKIE, REFRESH_COOKIE, refreshTokens, setTokenCookies, upstreamSignal } from "@/lib/auth/tokens";
import { env } from "@/lib/env";

/**
 * Same-origin passthrough to the backend for client components (TanStack Query, openapi-fetch with baseUrl "/api").
 * Attaches the bearer token from the httpOnly cookie, refreshes once on 401, and streams the response back.
 */
const FORWARD_REQ = ["content-type", "accept", "accept-language", "x-currency", "x-units", "x-unit", "idempotency-key", "if-none-match", "x-request-id"];
const ADMIN_ALLOW = parseAllowlist(process.env.ADMIN_IP_ALLOWLIST);
const FORWARD_RES = ["content-type", "etag", "cache-control", "x-request-id", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "content-disposition"];

async function handle(req: Request, ctx: RouteContext<"/api/v1/[...path]">) {
  const blocked = await assertSameOrigin(req);
  if (blocked) return blocked;
  const { path } = await ctx.params;
  if (path.some((p) => p === ".." || p.includes("/"))) return problem(400, "bad_path", "Bad request");
  // Same allow-list as the /admin pages (proxy.ts), so admin API calls can't bypass it through the BFF.
  if (path[0] === "admin" && !ipAllowed(clientIp(req.headers), ADMIN_ALLOW)) return problem(404, "not_found", "Not found");
  const url = new URL(req.url);
  const target = `${env.apiUrl}/v1/${path.map(encodeURIComponent).join("/")}${url.search}`;
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(); // buffered so a retry can resend it
  const jar = await cookies();

  const send = (token?: string) => {
    const h = new Headers();
    for (const k of FORWARD_REQ) { const v = req.headers.get(k); if (v) h.set(k, v); }
    if (token) h.set("authorization", `Bearer ${token}`);
    for (const [k, v] of Object.entries(forwardedFor(req))) h.set(k, v);
    // Exports and report downloads can be slow; everything else uses the normal timeout.
    return fetch(target, { method: req.method, headers: h, body, cache: "no-store", redirect: "manual", signal: upstreamSignal(/\/(export|reports|download)/.test(target)) });
  };

  let res: Response;
  try { res = await send(jar.get(ACCESS_COOKIE)?.value); } catch (e) { return upstreamUnavailable(env.apiUrl, e); }

  if (res.status === 401 && jar.get(REFRESH_COOKIE)) {
    const r = await refreshTokens(env.apiUrl, jar.get(REFRESH_COOKIE)!.value);
    if (r.kind === "ok") {
      setTokenCookies(jar, r.tokens);
      res = await send(r.tokens.accessToken);
    }
  }

  const headers = new Headers();
  for (const k of FORWARD_RES) { const v = res.headers.get(k); if (v) headers.set(k, v); }
  // Rejections are logged with their code; the body is read only for those (errors are small JSON documents).
  if (res.status >= 400) {
    const text = await res.text();
    logRejected(req.method, `/v1/${path.join("/")}`, res.status, text);
    return new NextResponse(text, { status: res.status, headers });
  }
  return new NextResponse(res.body, { status: res.status, headers });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
