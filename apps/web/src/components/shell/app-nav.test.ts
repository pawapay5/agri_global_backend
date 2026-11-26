import { describe, expect, it } from "vitest";
import { isStaff, navFor, needsShopCheck, sellerStatus, type SellerStatus } from "./app-nav";

const keys = (role: string, extra: Partial<{ inOrg: boolean; seller: SellerStatus }> = {}) =>
  navFor({ role, inOrg: false, seller: "none", ...extra }).flatMap((g) => g.items.map((i) => i.key));

describe("app sidebar by role", () => {
  it("everyone starts as a buyer: Become a seller, not the Seller centre", () => {
    for (const r of ["farmer", "trader", "consumer"]) {
      expect(keys(r)).toContain("becomeSeller");
      expect(keys(r)).not.toContain("sell");
    }
  });
  it("the Seller centre only appears once the application is approved", () => {
    expect(keys("consumer", { seller: "pending" })).not.toContain("sell");
    expect(keys("consumer", { seller: "rejected" })).toContain("becomeSeller");
    expect(keys("consumer", { seller: "verified" })).toContain("sell");
    expect(keys("consumer", { seller: "verified" })).not.toContain("becomeSeller");
  });
  it("staff aren't offered the seller application", () => {
    expect(keys("admin")).not.toContain("becomeSeller");
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
  it("looks up the seller profile for everyone but staff", () => {
    expect(needsShopCheck("farmer")).toBe(true);
    expect(needsShopCheck("admin")).toBe(false);
  });
  it("reads the seller status from the profile", () => {
    expect(sellerStatus(undefined)).toBe("none");
    expect(sellerStatus({ kycStatus: "pending" })).toBe("pending");
    expect(sellerStatus({ kycStatus: "weird" })).toBe("none");
  });
});
