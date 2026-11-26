import { describe, expect, it } from "vitest";
import { isUnknownPublicPath, slugIndex } from "./pack-index";

describe("public path validation (real 404s)", () => {
  const idx = slugIndex();
  it("loads the Ghana pack", () => {
    expect(idx.countries.has("gh")).toBe(true);
    expect(idx.markets.get("gh")?.has("kumasi-central")).toBe(true);
  });
  it("accepts known slugs and sections without a slug", () => {
    for (const p of [["gh", "prices"], ["gh", "prices", "tomato"], ["gh", "markets", "kumasi-central"], ["gh", "regions", "ah"], ["gh", "marketplace"], ["gh", "marketplace", "anything-uuid"], ["guides", "tomato"], ["methodology"], [], ["app", "alerts"]]) {
      expect(isUnknownPublicPath(p, idx), p.join("/")).toBe(false);
    }
  });
  it("never treats app or admin areas as a country (regression: /app/markets/* returned 404)", () => {
    for (const p of [["app", "markets"], ["app", "markets", "map"], ["app", "markets", "nearby"], ["admin", "markets", "x"], ["api", "prices"]]) {
      expect(isUnknownPublicPath(p, idx), p.join("/")).toBe(false);
    }
  });
  it("rejects unknown countries, crops, markets, regions and guide crops", () => {
    for (const p of [["zz", "prices"], ["gh", "prices", "not-a-crop"], ["gh", "markets", "nowhere"], ["gh", "regions", "xx"], ["guides", "not-a-crop"]]) {
      expect(isUnknownPublicPath(p, idx), p.join("/")).toBe(true);
    }
  });
});
