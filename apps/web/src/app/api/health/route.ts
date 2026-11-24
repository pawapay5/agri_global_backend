import { connection, NextResponse } from "next/server";

/** Liveness for Docker/Coolify health checks. Doesn't call the API: a backend outage shouldn't restart the web. */
export async function GET() {
  await connection();
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
