import { describe, expect, it } from "vitest";
import { feedScore, isoWeek, moderateText, parseMentions, rankFeed } from "./community.logic";

const now = new Date("2026-06-10T12:00:00Z");
const post = (o: Partial<Parameters<typeof feedScore>[0]> & { id: string }) => ({
  createdAt: now, authorId: "a", reactions: 0, comments: 0, shares: 0, distanceKm: null, type: "tip", acceptedAnswer: false, ...o,
});

describe("feed ranking", () => {
  it("decays with age (half-life 24h)", () => {
    const fresh = feedScore(post({ id: "1" }), new Set(), now);
    const old = feedScore(post({ id: "2", createdAt: new Date(now.getTime() - 24 * 3_600_000) }), new Set(), now);
    expect(old / fresh).toBeCloseTo(0.5, 5);
  });
  it("boosts follows, proximity and engagement", () => {
    const base = feedScore(post({ id: "1" }), new Set(), now);
    expect(feedScore(post({ id: "1" }), new Set(["a"]), now)).toBeGreaterThan(base);
    expect(feedScore(post({ id: "1", distanceKm: 10 }), new Set(), now)).toBeGreaterThan(base);
    expect(feedScore(post({ id: "1", comments: 10 }), new Set(), now)).toBeGreaterThan(base);
  });
  it("limits one author's dominance", () => {
    const posts = [1, 2, 3, 4].map((i) => post({ id: `a${i}`, authorId: "a", reactions: 100 })).concat([post({ id: "b1", authorId: "b" })]);
    const ranked = rankFeed(posts, new Set(), now).map((p) => p.id);
    expect(ranked.slice(0, 3)).toContain("b1");
  });
});

describe("helpers", () => {
  it("parses mentions", () => expect(parseMentions("Thanks @Ama_K and @kofi.mensah! email@x.com @ab")).toEqual(["ama_k", "kofi.mensah"]));
  it("computes ISO weeks", () => { expect(isoWeek(new Date("2026-01-01T00:00:00Z"))).toBe("2026-W01"); expect(isoWeek(new Date("2024-12-30T00:00:00Z"))).toBe("2025-W01"); });
  it("moderates text", () => {
    expect(moderateText("Maize is 450 per bag at Techiman today").verdict).toBe("allow");
    expect(moderateText("BUY NOW BUY NOW BUY NOW BUY NOW BUY NOW BUY NOW").verdict).toBe("review");
    expect(moderateText("I will kill you").verdict).toBe("block");
  });
});
