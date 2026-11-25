import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { connection } from "next/server";
import createClient from "openapi-fetch";
import { env } from "../env";
import type { components, paths } from "./schema";

export type S = components["schemas"];

/** Cache tags; the backend's revalidation webhook targets these (see /api/revalidate). */
export const tags = {
  prices: (cc: string) => `prices:${cc.toUpperCase()}`,
  catalogue: (cc: string) => `catalogue:${cc.toUpperCase()}`,
  content: "content",
  listings: (cc: string) => `listings:${cc.toUpperCase()}`,
  listing: (id: string) => `listing:${id}`,
};

/**
 * Server-side calls give up after SSR_FETCH_TIMEOUT_MS (default 5 s). A slow or half-up API (e.g. database down)
 * must not hang page renders or the build: the fetcher returns null and the page shows its "unavailable" state.
 */
const TIMEOUT_MS = Number(process.env.SSR_FETCH_TIMEOUT_MS ?? 5000);
/**
 * `next build` doesn't call the API unless BUILD_FETCH_LIVE_DATA=true. In a Docker/Coolify build the API isn't
 * reachable (it isn't running on the build network), and waiting on it breaks Next's cache warm-up. Pages still
 * prerender fully from the country packs; live prices become streamed holes filled (and cached) at request time.
 */
const SKIP_AT_BUILD = process.env.NEXT_PHASE === "phase-production-build" && process.env.BUILD_FETCH_LIVE_DATA !== "true";
const timedFetch: typeof fetch = (input, init) => {
  const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS);
  if (input instanceof Request) return fetch(new Request(input, { signal }));
  return fetch(input, { ...init, signal });
};
/**
 * Call at the top of a server component that renders live API data (outside "use cache"). During a build that
 * skips live data, it marks the component as request-time explicitly, so Next leaves a streamed hole without
 * first trying (and failing) to prerender it. A no-op at runtime.
 */
export async function liveData() {
  if (SKIP_AT_BUILD) await connection();
}

/** Circuit breaker shared by all server fetchers in this process. */
const BREAKER_MS = 15_000;
let breakerOpenUntil = 0;

const api = () => createClient<paths>({ baseUrl: env.apiUrl, headers: { "X-Client": "agriprice-web-ssr" }, fetch: timedFetch });

/**
 * Every public fetcher: cached with a lifetime + tag. If the API is unreachable, the empty result is
 * cached only for seconds so an outage never sticks to a page for the full lifetime.
 */
async function guard<T>(fn: () => Promise<{ data?: T; error?: unknown }>): Promise<T | null> {
  if (SKIP_AT_BUILD || Date.now() < breakerOpenUntil) { cacheLife("seconds"); return null; }
  try {
    const r = await fn();
    if (r.data !== undefined) return r.data;
  } catch {
    // Network error or timeout: stop calling the API for a while so every render (and the build) doesn't
    // wait out its own timeout during an outage. HTTP errors (4xx/5xx) don't trip it.
    breakerOpenUntil = Date.now() + BREAKER_MS;
  }
  cacheLife("seconds");
  return null;
}

export async function getCountry(cc: string) {
  "use cache";
  cacheLife("days"); cacheTag(tags.catalogue(cc));
  return guard(() => api().GET("/v1/countries/{iso2}", { params: { path: { iso2: cc.toUpperCase() } } }));
}

export async function getCommodities(cc: string, locale: string) {
  "use cache";
  cacheLife("hours"); cacheTag(tags.catalogue(cc));
  const all: S["Commodity"][] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const page = await guard(() => api().GET("/v1/commodities", { params: { query: { country: cc.toUpperCase(), limit: 100, cursor } }, headers: { "Accept-Language": locale } }));
    if (!page) return all.length ? all : null;
    all.push(...page.data);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return all;
}

export async function getLatest(commodityId: string, cc: string, priceType: S["PriceType"] = "wholesale") {
  "use cache";
  cacheLife("minutes"); cacheTag(tags.prices(cc));
  return guard(() => api().GET("/v1/prices/latest", { params: { query: { commodity_id: commodityId, country: cc.toUpperCase(), price_type: priceType } } }));
}

export async function getHistory(commodityId: string, cc: string, range: "1M" | "3M" | "6M" | "1Y" = "6M", priceType: S["PriceType"] = "wholesale") {
  "use cache";
  cacheLife("hours"); cacheTag(tags.prices(cc));
  return guard(() => api().GET("/v1/prices/history", { params: { query: { commodity_id: commodityId, country: cc.toUpperCase(), range, interval: range === "1Y" ? "week" : "day", price_type: priceType } } }));
}

export async function getSeasonal(commodityId: string, cc: string, locale: string) {
  "use cache";
  cacheLife("days"); cacheTag(tags.prices(cc));
  return guard(() => api().GET("/v1/insights/seasonal", { params: { query: { commodity_id: commodityId, country: cc.toUpperCase() } }, headers: { "Accept-Language": locale } }));
}

export async function getSnapshot(cc: string) {
  "use cache";
  cacheLife("minutes"); cacheTag(tags.prices(cc));
  return guard(() => api().GET("/v1/dashboard/snapshot", { params: { query: { country: cc.toUpperCase() } } }));
}

export async function getTrending(cc: string) {
  "use cache";
  cacheLife("minutes"); cacheTag(tags.prices(cc));
  return guard(() => api().GET("/v1/prices/trending", { params: { query: { country: cc.toUpperCase(), limit: 10 } } }));
}

export async function getImpact(cc: string) {
  "use cache";
  cacheLife("hours"); cacheTag(tags.content);
  return guard(() => api().GET("/v1/content/impact", { params: { query: { country: cc.toUpperCase() } } }));
}

export async function getStories(cc: string, locale: string) {
  "use cache";
  cacheLife("hours"); cacheTag(tags.content);
  return guard(() => api().GET("/v1/content/stories", { params: { query: { country: cc.toUpperCase(), limit: 3 } }, headers: { "Accept-Language": locale } }));
}

/** URL slug ⇄ catalogue code: "maize-white" ⇄ "maize_white". */
export const slugOf = (code: string) => code.replace(/_/g, "-");
export const codeOf = (slug: string) => slug.replace(/-/g, "_");

export async function findCommodity(cc: string, slug: string, locale: string) {
  const list = await getCommodities(cc, locale);
  return list?.find((c) => c.code === codeOf(slug)) ?? null;
}

// ── Markets, regions, content, plans, marketplace ──

/** All markets of a country (paged API, cached for hours): maps pack codes to API ids. */
export async function getMarkets(cc: string) {
  "use cache";
  cacheLife("hours"); cacheTag(tags.catalogue(cc));
  const all: S["Market"][] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const page = await guard(() => api().GET("/v1/markets", { params: { query: { country: cc.toUpperCase(), limit: 100, cursor } } }));
    if (!page) return all.length ? all : null;
    all.push(...page.data);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return all;
}

export async function findMarket(cc: string, code: string) {
  return (await getMarkets(cc))?.find((m) => m.code === code) ?? null;
}

export async function getRegions(cc: string) {
  "use cache";
  cacheLife("days"); cacheTag(tags.catalogue(cc));
  return guard(() => api().GET("/v1/regions", { params: { query: { country: cc.toUpperCase() } } }));
}

/** Average price per region for one commodity over the last 30 days. */
export async function getChoropleth(commodityId: string, cc: string) {
  "use cache";
  cacheLife("hours"); cacheTag(tags.prices(cc));
  return guard(() => api().GET("/v1/regions/choropleth", { params: { query: { country: cc.toUpperCase(), commodity_id: commodityId, days: 30 } } }));
}

export async function getRegionsGeo(cc: string) {
  "use cache";
  cacheLife("days"); cacheTag(tags.catalogue(cc));
  return guard(() => api().GET("/v1/regions/geojson", { params: { query: { country: cc.toUpperCase() } } }));
}

export async function getArticles(cc: string, locale: string) {
  "use cache";
  cacheLife("hours"); cacheTag(tags.content);
  return guard(() => api().GET("/v1/content/articles", { params: { query: { country: cc.toUpperCase() } }, headers: { "Accept-Language": locale } }));
}

export async function getArticle(slug: string, locale: string) {
  "use cache";
  cacheLife("hours"); cacheTag(tags.content);
  return guard(() => api().GET("/v1/content/articles/{slug}", { params: { path: { slug } }, headers: { "Accept-Language": locale } }));
}

export async function getFaqs(cc: string, locale: string) {
  "use cache";
  cacheLife("hours"); cacheTag(tags.content);
  return guard(() => api().GET("/v1/content/faqs", { params: { query: { country: cc.toUpperCase() } }, headers: { "Accept-Language": locale } }));
}

export async function getAllStories(cc: string, locale: string) {
  "use cache";
  cacheLife("hours"); cacheTag(tags.content);
  return guard(() => api().GET("/v1/content/stories", { params: { query: { country: cc.toUpperCase(), limit: 50 } }, headers: { "Accept-Language": locale } }));
}

export async function getGuides(cc: string, locale: string, commodityId?: string) {
  "use cache";
  cacheLife("hours"); cacheTag(tags.content);
  return guard(() => api().GET("/v1/knowledge/crop-guides", { params: { query: { country: cc.toUpperCase(), commodity_id: commodityId } }, headers: { "Accept-Language": locale } }));
}

export async function getGuide(id: string, locale: string) {
  "use cache";
  cacheLife("hours"); cacheTag(tags.content);
  return guard(() => api().GET("/v1/knowledge/crop-guides/{id}", { params: { path: { id } }, headers: { "Accept-Language": locale } }));
}

export async function getPests(cc: string, locale: string) {
  "use cache";
  cacheLife("hours"); cacheTag(tags.content);
  return guard(() => api().GET("/v1/knowledge/pests", { params: { query: { country: cc.toUpperCase() } }, headers: { "Accept-Language": locale } }));
}

export async function getPest(id: string, locale: string) {
  "use cache";
  cacheLife("hours"); cacheTag(tags.content);
  return guard(() => api().GET("/v1/knowledge/pests/{id}", { params: { path: { id } }, headers: { "Accept-Language": locale } }));
}

export async function getPlans(cc: string, locale: string) {
  "use cache";
  cacheLife("hours"); cacheTag(tags.content);
  return guard(() => api().GET("/v1/billing/plans", { params: { query: { country: cc.toUpperCase() } }, headers: { "Accept-Language": locale } }));
}

export async function getListings(cc: string) {
  "use cache";
  cacheLife("minutes"); cacheTag(tags.listings(cc));
  return guard(() => api().GET("/v1/marketplace/listings", { params: { query: { country: cc.toUpperCase(), limit: 48 } } }));
}

export async function getListing(id: string) {
  "use cache";
  cacheLife("minutes"); cacheTag(tags.listing(id));
  return guard(() => api().GET("/v1/marketplace/listings/{id}", { params: { path: { id } } }));
}

/**
 * Readable slug that ends in the record's UUID, for records without their own slug (pests, listings):
 * "fall-armyworm-6f1c…". The page reads the id back from the last 36 characters.
 */
export const idSlug = (title: string, id: string) =>
  `${title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)}-${id}`.replace(/^-/, "");
export const idFromSlug = (slug: string) => {
  const m = slug.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  return m ? m[0].toLowerCase() : null;
};
