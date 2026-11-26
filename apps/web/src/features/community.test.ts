import { describe, expect, it } from "vitest";
import { postProblem } from "./community";
import { phoneLinks, priceReportProblem } from "./tools";

describe("postProblem", () => {
  it("needs text", () => expect(postProblem({ type: "tip", body: "  " })).toBe("bodyRequired"));
  it("a price update needs a market and a positive price", () => {
    expect(postProblem({ type: "price_update", body: "Tomatoes today", marketId: "", amount: "12" })).toBe("priceRequired");
    expect(postProblem({ type: "price_update", body: "Tomatoes today", marketId: "m", amount: "0" })).toBe("priceRequired");
    expect(postProblem({ type: "price_update", body: "Tomatoes today", marketId: "m", amount: "12" })).toBeNull();
  });
});

describe("priceReportProblem", () => {
  const now = Date.parse("2026-11-25T12:00:00Z");
  it("accepts a sensible report", () => expect(priceReportProblem({ marketId: "m", amount: "15", observedAt: "2026-11-25T09:00:00Z" }, now)).toBeNull());
  it("rejects missing market, bad price and future times", () => {
    expect(priceReportProblem({ marketId: "", amount: "15", observedAt: "2026-11-25T09:00:00Z" }, now)).toBe("pickMarket");
    expect(priceReportProblem({ marketId: "m", amount: "-1", observedAt: "2026-11-25T09:00:00Z" }, now)).toBe("priceBad");
    expect(priceReportProblem({ marketId: "m", amount: "15", observedAt: "2026-11-26T09:00:00Z" }, now)).toBe("whenBad");
  });
});

describe("phoneLinks", () => {
  it("builds tel: and wa.me links from digits only", () => expect(phoneLinks("+233 (24) 123-4567")).toEqual({ tel: "tel:+233241234567", wa: "https://wa.me/233241234567" }));
  it("strips anything that could inject into the URL", () => expect(phoneLinks("0241234567?text=hi&x=javascript:")?.tel).toBe("tel:0241234567"));
  it("rejects too-short numbers", () => expect(phoneLinks("123")).toBeNull());
});
