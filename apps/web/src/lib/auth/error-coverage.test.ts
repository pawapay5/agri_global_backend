import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";

/**
 * Every error code the API's auth and user modules can return must have a message in the web app; otherwise the
 * user sees "Something went wrong" and nothing explains why. Fails when the backend adds a code without one.
 */
const API_SRC = join(process.cwd(), "..", "api", "src", "modules");
const MODULES = ["auth", "users"];
const CODE = /AppError\.(?:unauthorized|forbidden|badRequest|conflict|tooMany|unprocessable)\("([a-z_]+)"|new AppError\(\d+,\s*"([a-z_]+)"/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") && !p.endsWith(".spec.ts") ? [p] : [];
  });
}

describe("API auth error codes have web messages", () => {
  const codes = new Set<string>();
  for (const m of MODULES) for (const f of files(join(API_SRC, m))) for (const x of readFileSync(f, "utf8").matchAll(CODE)) codes.add((x[1] ?? x[2])!);

  it("finds the API's codes (sanity check)", () => expect(codes.size).toBeGreaterThan(20));
  it("has an English message for each", () => {
    const known = new Set(Object.keys(en.auth.errors));
    expect([...codes].filter((c) => !known.has(c)).sort()).toEqual([]);
  });
});
