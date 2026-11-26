import { describe, expect, it } from "vitest";
import { isStaff, navFor, needsShopCheck } from "./app-nav";

const keys = (role: string, extra: Partial<{ inOrg: boolean; hasShop: boolean }> = {}) =>
  navFor({ role, inOrg: false, hasShop: false, ...extra }).flatMap((g) => g.items.map((i) => i.key));

describe("app sidebar by role", () => {
  it("farmers and traders always get the seller centre", () => {
    expect(keys("farmer")).toContain("sell");
    expect(keys("trader")).toContain("sell");
  });
  it("other roles get the seller centre once they have a shop", () => {
    expect(keys("consumer")).not.toContain("sell");
    expect(keys("consumer", { hasShop: true })).toContain("sell");
  });
  it("consumers don't see reports, data or developer tools", () => {
    expect(keys("consumer")).not.toEqual(expect.arrayContaining(["reports"]));
    expect(keys("consumer")).not.toContain("data");
    expect(keys("consumer")).not.toContain("developers");
  });
  it("data roles get developer tools", () => {
    for (const r of ["researcher", "policymaker", "student", "admin"]) expect(keys(r)).toContain("developers");
    expect(keys("farmer")).not.toContain("developers");
  });
  it("organisation only for members and org admins", () => {
    expect(keys("farmer")).not.toContain("org");
    expect(keys("farmer", { inOrg: true })).toContain("org");
    expect(keys("org_admin")).toContain("org");
  });
  it("everyone keeps the five everyday sections", () => {
    for (const r of ["farmer", "consumer", "researcher", "admin"]) expect(keys(r)).toEqual(expect.arrayContaining(["home", "commodities", "markets", "forecast", "alerts"]));
  });
});

describe("helpers", () => {
  it("knows the staff roles", () => {
    expect(["admin", "org_admin", "enumerator", "agronomist"].every(isStaff)).toBe(true);
    expect(isStaff("farmer")).toBe(false);
    expect(isStaff(undefined)).toBe(false);
  });
  it("only checks for a shop when the role doesn't decide", () => {
    expect(needsShopCheck("farmer")).toBe(false);
    expect(needsShopCheck("consumer")).toBe(true);
  });
});
