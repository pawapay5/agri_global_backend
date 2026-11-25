import { connection, NextResponse } from "next/server";
import { upstreamSignal } from "@/lib/auth/tokens";
import { env } from "@/lib/env";

/**
 * GET /api/health: liveness for Docker/Coolify health checks. Doesn't call the API: a backend outage shouldn't
 * restart the web container.
 *
 * GET /api/health?deep=1: a deployment check for people, not orchestrators. Reports whether this web container
 * can reach the API, the API's own readiness (Postgres, Redis), and how many countries are loaded. If countries
 * is 0, the country pack was never seeded and sign-up fails with "country_unsupported". No secrets or user data.
 */
export async function GET(req: Request) {
  await connection();
  const noStore = { "Cache-Control": "no-store" };
  if (!new URL(req.url).searchParams.has("deep")) return NextResponse.json({ status: "ok" }, { headers: noStore });

  const get = async (path: string) => {
    try {
      const r = await fetch(`${env.apiUrl}${path}`, { cache: "no-store", signal: upstreamSignal() });
      return { status: r.status, body: (await r.json().catch(() => null)) as unknown };
    } catch (e) {
      return { status: 0, error: (e as { cause?: { code?: string } }).cause?.code ?? (e as Error).message };
    }
  };
  const [ready, countries] = await Promise.all([get("/readyz"), get("/v1/countries")]);
  const countryList = Array.isArray(countries.body) ? (countries.body as { iso2?: string }[]) : null;
  const api = ready.status === 0
    ? { reachable: false, error: ready.error, url: new URL(env.apiUrl).origin }
    : { reachable: true, ready: ready.status === 200, checks: (ready.body as { checks?: unknown } | null)?.checks ?? null };
  const seeded = countryList ? { countries: countryList.length, iso2: countryList.map((c) => c.iso2).filter(Boolean) } : { countries: null, status: countries.status };
  const ok = api.reachable && "ready" in api && api.ready && (countryList?.length ?? 0) > 0;
  return NextResponse.json({ status: ok ? "ok" : "degraded", web: "ok", api, data: seeded }, { status: ok ? 200 : 503, headers: noStore });
}
