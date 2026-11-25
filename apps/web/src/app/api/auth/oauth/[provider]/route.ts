import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { assertSameOrigin, deviceInfo, forwardedFor, logRejected, problem, rateLimit, upstreamUnavailable } from "@/lib/auth/bff";
import { setMfaCookie, setTokenCookies, type TokenPair, upstreamSignal } from "@/lib/auth/tokens";
import { env } from "@/lib/env";

/** Exchanges a Google/Apple ID token or Facebook access token (obtained client-side via the provider SDK) for a session. */
export async function POST(req: Request, ctx: RouteContext<"/api/auth/oauth/[provider]">) {
  const { provider } = await ctx.params;
  if (!["google", "apple", "facebook"].includes(provider)) return problem(404, "not_found", "Not found");
  const blocked = await assertSameOrigin(req);
  if (blocked) return blocked;
  const limited = await rateLimit(req, "oauth");
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { token?: string; nonce?: string; country?: string; fullName?: string } | null;
  if (!body?.token) return problem(422, "token_required", "Unprocessable entity");

  const upstream = await fetch(`${env.apiUrl}/v1/auth/oauth/${provider}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...forwardedFor(req) }, cache: "no-store", signal: upstreamSignal(),
    body: JSON.stringify({ ...body, device: await deviceInfo(req.headers.get("user-agent")) }),
  }).catch((e: unknown) => e as Error);
  if (upstream instanceof Error) return upstreamUnavailable(env.apiUrl, upstream);
  if (!upstream.ok) {
    const text = await upstream.text();
    logRejected("POST", `/v1/auth/oauth/${provider}`, upstream.status, text);
    return new NextResponse(text, { status: upstream.status, headers: { "Content-Type": "application/problem+json" } });
  }
  const data = (await upstream.json()) as { status: string; tokens?: TokenPair; mfaToken?: string; user?: unknown; isNewUser?: boolean };
  const jar = await cookies();
  if (data.tokens) setTokenCookies(jar, data.tokens);
  if (data.mfaToken) setMfaCookie(jar, data.mfaToken);
  return NextResponse.json({ status: data.status, user: data.user, isNewUser: data.isNewUser });
}
