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
  const body = (await req.json().catch(() => ({}))) as { country?: string; scopes?: string[] };
  const country = (body.country ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return NextResponse.json({ code: "country_required" }, { status: 422 });
  const scopes = body.scopes?.length ? body.scopes : ["prices"];
  const done: string[] = [];
  for (const s of scopes) {
    const tag = s === "catalogue" ? tags.catalogue(country) : s === "content" ? tags.content : tags.prices(country);
    revalidateTag(tag, "max"); // stale-while-revalidate: visitors never wait on a cold page
    done.push(tag);
  }
  return NextResponse.json({ revalidated: done });
}
