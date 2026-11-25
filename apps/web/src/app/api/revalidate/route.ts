import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { tags } from "@/lib/api/public";

/**
 * On-demand revalidation webhook, called by the backend when new price aggregates land.
 *   POST /api/revalidate  { "country": "GH", "scopes": ["prices", "catalogue"] }   header: x-revalidate-secret
 */
export async function POST(req: Request) {
  const got = Buffer.from(req.headers.get("x-revalidate-secret") ?? "");
  const want = Buffer.from(env.revalidateSecret);
  if (!want.length || got.length !== want.length || !timingSafeEqual(got, want)) {
    return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { country?: string; scopes?: string[]; tags?: string[] };
  const country = (body.country ?? "").toUpperCase();
  const explicit = (body.tags ?? []).filter((t) => /^(listing:[0-9a-f-]{36}|content)$/.test(t)); // e.g. one edited listing
  if (!/^[A-Z]{2}$/.test(country) && !explicit.length) return NextResponse.json({ code: "country_required" }, { status: 422 });
  const scopes = body.scopes?.length ? body.scopes : explicit.length ? [] : ["prices"];
  const byScope: Record<string, (cc: string) => string> = {
    prices: tags.prices, catalogue: tags.catalogue, listings: tags.listings, content: () => tags.content,
  };
  const done: string[] = [];
  for (const t of [...scopes.filter((s) => byScope[s]).map((s) => byScope[s]!(country)), ...explicit]) {
    revalidateTag(t, "max"); // stale-while-revalidate: visitors never wait on a cold page
    done.push(t);
  }
  return NextResponse.json({ revalidated: done });
}
