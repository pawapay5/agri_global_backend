import type { Logger } from "pino";

export interface RevalidateConfig { url?: string; secret?: string }

/**
 * Tells the web app that a country's prices changed so its ISR/`'use cache'` price pages refresh
 * (POST {WEB_REVALIDATE_URL} with x-revalidate-secret). Best effort: if unset or the web app is down,
 * pages still refresh when their cache lifetime ends, so failures are logged, never thrown.
 */
export async function revalidateWeb(countries: string[], cfg: RevalidateConfig, log: Logger, fetcher: typeof fetch = fetch) {
  if (!cfg.url || !cfg.secret || !countries.length) return 0;
  let ok = 0;
  for (const country of [...new Set(countries.map((c) => c.toUpperCase()))]) {
    try {
      const res = await fetcher(cfg.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-revalidate-secret": cfg.secret },
        body: JSON.stringify({ country, scopes: ["prices"] }),
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) ok++;
      else log.warn({ country, status: res.status }, "web revalidate rejected");
    } catch (err) {
      log.warn({ country, err: (err as Error).message }, "web revalidate failed");
    }
  }
  return ok;
}
