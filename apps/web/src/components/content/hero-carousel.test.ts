import { describe, expect, it } from "vitest";
import { wrap } from "./hero-carousel";

describe("wrap", () => {
  it("cycles forwards and backwards through the slides", () => {
    expect(wrap(5, 5)).toBe(0);
    expect(wrap(-1, 5)).toBe(4);
    expect(wrap(2, 5)).toBe(2);
    expect(wrap(-6, 5)).toBe(4);
  });
});
