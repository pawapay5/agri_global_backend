import { describe, expect, it } from "vitest";
import { classifyRefresh } from "./session.service";

const base = { usedAt: null, revokedAt: null, expiresAt: new Date(Date.now() + 1000) };

describe("classifyRefresh", () => {
  it("accepts a fresh token", () => expect(classifyRefresh(base)).toBe("ok"));
  it("detects reuse of a rotated token (takes precedence over revoke)", () => {
    expect(classifyRefresh({ ...base, usedAt: new Date(), revokedAt: new Date() })).toBe("reuse");
  });
  it("rejects revoked tokens", () => expect(classifyRefresh({ ...base, revokedAt: new Date() })).toBe("revoked"));
  it("rejects expired tokens", () => expect(classifyRefresh({ ...base, expiresAt: new Date(Date.now() - 1) })).toBe("expired"));
});
