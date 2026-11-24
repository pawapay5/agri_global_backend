/**
 * The visitor's IP as seen by our edge proxy.
 * - CLIENT_IP_HEADER (e.g. `cf-connecting-ip` when Cloudflare sits in front of Coolify) wins when set.
 * - Otherwise the right-most X-Forwarded-For entry: the one appended by the single trusted proxy
 *   (Coolify's Traefik). Left-hand entries are client-controlled and never trusted.
 */
export function clientIp(headers: Headers): string | null {
  const custom = process.env.CLIENT_IP_HEADER?.toLowerCase();
  if (custom) {
    const v = headers.get(custom)?.trim();
    if (v) return v;
  }
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1]!;
  }
  return headers.get("x-real-ip")?.trim() || null;
}
