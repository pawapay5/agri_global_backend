import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without types
import { passwordProblem as scriptRule, readAdminConfig, seedCountries } from "../../scripts/seed-admin.lib.mjs";
import { passwordProblem as apiRule } from "../modules/auth/credentials";

describe("admin seed config", () => {
  it("skips quietly when no admin is configured", () => expect(readAdminConfig({})).toEqual({ skip: "ADMIN_EMAIL and ADMIN_PASSWORD are not set" }));
  it("rejects bad settings instead of creating a weak admin", () => {
    expect(readAdminConfig({ ADMIN_EMAIL: "nope", ADMIN_PASSWORD: "Strong-pass-2026!" }).error).toMatch(/ADMIN_EMAIL/);
    expect(readAdminConfig({ ADMIN_EMAIL: "ops@example.org" }).error).toMatch(/ADMIN_PASSWORD is required/);
    expect(readAdminConfig({ ADMIN_EMAIL: "ops@example.org", ADMIN_PASSWORD: "short" }).error).toMatch(/at least 10/);
    expect(readAdminConfig({ ADMIN_EMAIL: "ops@example.org", ADMIN_PASSWORD: "Strong-pass-2026!", ADMIN_COUNTRY: "Ghana" }).error).toMatch(/ADMIN_COUNTRY/);
  });
  it("normalises a good config", () => {
    expect(readAdminConfig({ ADMIN_EMAIL: " Ops@Example.org ", ADMIN_PASSWORD: "Strong-pass-2026!", ADMIN_COUNTRY: "gh", ADMIN_PASSWORD_RESET: "true" }))
      .toEqual({ email: "ops@example.org", password: "Strong-pass-2026!", country: "GH", name: "Administrator", reset: true });
  });
  it("uses the same password rules as the API", () => {
    for (const [pw, email] of [["short", null], ["aaaaaaaaaaaa", null], ["MyPassword2026", null], ["kwame-secret-99", "kwame@example.org"], ["Strong-pass-2026!", "ops@example.org"]] as const) {
      expect(scriptRule(pw, email) === null).toBe(apiRule(pw, email) === null);
    }
  });
});

describe("seedCountries", () => {
  it("defaults to Ghana and accepts a list", () => {
    expect(seedCountries({})).toEqual(["gh"]);
    expect(seedCountries({ SEED_COUNTRIES: "GH, ng gh" })).toEqual(["gh", "ng"]);
  });
  it("can be turned off", () => expect(seedCountries({ SEED_COUNTRIES: "none" })).toEqual([]));
});
