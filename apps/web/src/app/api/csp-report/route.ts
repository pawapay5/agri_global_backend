import { NextResponse } from "next/server";

/** CSP violation reports (report-uri). Logged compactly; bodies are capped so this can't be used to flood logs. */
export async function POST(req: Request) {
  const text = (await req.text().catch(() => "")).slice(0, 4000);
  try {
    const r = (JSON.parse(text)["csp-report"] ?? {}) as Record<string, string>;
    console.warn(`[csp] ${r["effective-directive"] ?? r["violated-directive"] ?? "?"} blocked ${r["blocked-uri"] ?? "?"} on ${r["document-uri"] ?? "?"}`);
  } catch { /* ignore malformed reports */ }
  return new NextResponse(null, { status: 204 });
}
