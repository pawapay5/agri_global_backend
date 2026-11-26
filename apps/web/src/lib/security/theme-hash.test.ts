import { describe, expect, it } from "vitest";
import { THEME_SCRIPT_HASH } from "@/lib/theme";
import { buildCsp } from "./csp";

// The hash itself is verified against the real build in e2e (no CSP violations on signed-in pages).
describe("theme script CSP hash", () => {
  it("is allowed by the strict policy only", () => {
    expect(THEME_SCRIPT_HASH).toMatch(/^sha256-[A-Za-z0-9+/]{43}=$/);
    expect(buildCsp({ nonce: "n", dev: false })).toContain(`'${THEME_SCRIPT_HASH}'`);
    expect(buildCsp({ dev: false })).not.toContain(THEME_SCRIPT_HASH);
  });
});
