/** Feed ranking, reputation rules and mention parsing. */

export interface FeedCandidate {
  id: string; createdAt: Date; authorId: string; reactions: number; comments: number; shares: number;
  distanceKm: number | null; type: string; acceptedAnswer: boolean;
}

export const FEED_HALF_LIFE_HOURS = 24;

/**
 * score = recency × (1 + engagement) × follow boost × proximity boost.
 * Recency halves every 24 h; engagement is log-damped so viral posts don't starve new ones.
 */
export function feedScore(p: FeedCandidate, following: Set<string>, now = new Date()): number {
  const ageH = Math.max(0, (now.getTime() - p.createdAt.getTime()) / 3_600_000);
  const recency = Math.pow(0.5, ageH / FEED_HALF_LIFE_HOURS);
  const engagement = Math.log1p(p.reactions + 2 * p.comments + 3 * p.shares) / 3;
  const follow = following.has(p.authorId) ? 1.6 : 1;
  const near = p.distanceKm == null ? 1 : p.distanceKm <= 25 ? 1.5 : p.distanceKm <= 100 ? 1.25 : 1;
  const typeBoost = p.type === "price_update" ? 1.15 : p.type === "question" && !p.acceptedAnswer ? 1.1 : 1;
  return recency * (1 + engagement) * follow * near * typeBoost;
}

export function rankFeed<T extends FeedCandidate>(posts: T[], following: Set<string>, now = new Date()): T[] {
  // Diversity: at most 2 posts per author in any run of 10.
  const sorted = [...posts].sort((a, b) => feedScore(b, following, now) - feedScore(a, following, now));
  const out: T[] = []; const deferred: T[] = [];
  for (const p of sorted) {
    const window = out.slice(-9);
    if (window.filter((x) => x.authorId === p.authorId).length >= 2) deferred.push(p); else out.push(p);
  }
  return [...out, ...deferred];
}

export const REPUTATION: Record<string, number> = {
  post_created: 1, comment_created: 1, reaction_received: 1, answer_accepted: 15, price_approved: 5, post_removed: -20,
};

/** @mentions: @username tokens, 3–30 chars, deduplicated, max 10. */
export function parseMentions(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:^|[^\w@])@([a-zA-Z0-9_.]{3,30})/g)) out.add(m[1]!.toLowerCase());
  return [...out].slice(0, 10);
}

/** ISO week label for weekly badges, e.g. 2026-W23. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, "0")}`;
}

// ── text moderation (first pass; a hosted classifier can be plugged in behind the same interface) ──
const BLOCKLIST = [/\b(kill|murder)\s+(you|him|her|them)\b/i, /\b(nude|porn|sex\s*video)\b/i];
export function moderateText(text: string): { verdict: "allow" | "review" | "block"; reasons: string[] } {
  const reasons: string[] = [];
  if (BLOCKLIST.some((r) => r.test(text))) reasons.push("abusive_or_explicit");
  const links = (text.match(/https?:\/\//g) ?? []).length;
  if (links >= 3) reasons.push("link_spam");
  if (/(.)\1{9,}/.test(text) || /\b((?:\w+\s+){0,2}\w+)\b(?:\s+\1\b){3,}/i.test(text)) reasons.push("repetitive");
  const upper = text.replace(/[^A-Za-z]/g, "");
  if (upper.length > 40 && upper.replace(/[^A-Z]/g, "").length / upper.length > 0.8) reasons.push("shouting");
  const verdict = reasons.includes("abusive_or_explicit") ? "block" : reasons.length ? "review" : "allow";
  return { verdict, reasons };
}
