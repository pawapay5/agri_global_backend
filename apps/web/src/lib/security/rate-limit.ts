import "server-only";
import Redis from "ioredis";

/**
 * Fixed-window rate limiter in Redis (the stack's own Redis on Coolify, shared by every web replica).
 * Fails open: if Redis is down we log once and let the request through, because the backend applies its
 * own per-account and per-IP throttles on every auth endpoint. Disabled when REDIS_URL is unset (local dev).
 */
let client: Redis | null | undefined;
let warned = false;

function redis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.REDIS_URL;
  if (!url) {
    if (process.env.NODE_ENV === "production" && !warned) { warned = true; console.warn("[rate-limit] REDIS_URL not set: BFF rate limiting is off"); }
    return (client = null);
  }
  client = new Redis(url, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 2000 });
  client.on("error", (e: Error & { code?: string }) => { if (!warned) { warned = true; console.error(`[rate-limit] Redis unavailable (${e.code ?? e.message}); failing open`); } });
  client.on("ready", () => { warned = false; });
  return client;
}

export interface Limit { name: string; max: number; windowSeconds: number }
export type Verdict = { ok: true } | { ok: false; retryAfterSeconds: number };

export async function hit(limit: Limit, key: string, store: Pick<Redis, "multi"> | null = redis()): Promise<Verdict> {
  if (!store) return { ok: true };
  const window = Math.floor(Date.now() / 1000 / limit.windowSeconds);
  const k = `rl:web:${limit.name}:${key}:${window}`;
  try {
    const res = await store.multi().incr(k).expire(k, limit.windowSeconds + 1).exec();
    const count = Number(res?.[0]?.[1] ?? 0);
    if (count <= limit.max) return { ok: true };
    const reset = (window + 1) * limit.windowSeconds - Math.floor(Date.now() / 1000);
    return { ok: false, retryAfterSeconds: Math.max(1, reset) };
  } catch {
    return { ok: true };
  }
}

/** Per-IP limits for the auth BFF (the backend adds per-account limits and lockouts). */
export const AUTH_LIMITS: Record<string, Limit> = {
  login: { name: "login", max: 10, windowSeconds: 60 },
  register: { name: "register", max: 5, windowSeconds: 60 },
  "otp-request": { name: "otp-request", max: 5, windowSeconds: 60 },
  "otp-verify": { name: "otp-verify", max: 10, windowSeconds: 60 },
  mfa: { name: "mfa", max: 10, windowSeconds: 60 },
  forgot: { name: "forgot", max: 5, windowSeconds: 60 },
  reset: { name: "reset", max: 10, windowSeconds: 60 },
  oauth: { name: "oauth", max: 10, windowSeconds: 60 },
};
