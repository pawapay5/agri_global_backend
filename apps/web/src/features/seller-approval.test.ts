import { describe, expect, it } from "vitest";
import { sectionsFor } from "@/components/shell/admin-shell";
import { landingAfterSignIn } from "@/lib/auth/client";
import { sellerPageOpen } from "./seller";

describe("seller pages before approval", () => {
  it("keeps the application and shop details open to everyone", () => {
    expect(sellerPageOpen("/app/sell", "none")).toBe(true);
    expect(sellerPageOpen("/app/sell/profile", "pending")).toBe(true);
  });
  it("locks listings, orders and the wallet until approved", () => {
    for (const s of ["none", "pending", "rejected"] as const) {
      expect(sellerPageOpen("/app/sell/listings/new", s)).toBe(false);
      expect(sellerPageOpen("/app/sell/wallet", s)).toBe(false);
    }
    expect(sellerPageOpen("/app/sell/listings/new", "verified")).toBe(true);
  });
});

describe("landing after sign-in", () => {
  it("sends staff to the admin console and everyone else to the app", () => {
    expect(landingAfterSignIn({ next: null, locale: "en", role: "admin" })).toBe("/en/admin");
    expect(landingAfterSignIn({ next: null, locale: "en", role: "enumerator" })).toBe("/en/admin");
    expect(landingAfterSignIn({ next: null, locale: "fr", role: "farmer" })).toBe("/fr/app");
  });
  it("honours a safe return path and sends new accounts to setup", () => {
    expect(landingAfterSignIn({ next: "/en/app/alerts", locale: "en", role: "admin" })).toBe("/en/app/alerts");
    expect(landingAfterSignIn({ next: "//evil.example", locale: "en", role: "admin" })).toBe("/en/admin");
    expect(landingAfterSignIn({ next: null, locale: "en", role: "consumer", isNewUser: true })).toBe("/en/app/onboarding");
  });
});

describe("admin console", () => {
  it("gives admins and org admins the seller approvals queue, next to users", () => {
    const keys = (r: string) => sectionsFor(r).flatMap((g) => g.items.map((i) => i.key));
    expect(keys("admin")).toEqual(expect.arrayContaining(["users", "sellerApprovals"]));
    expect(keys("org_admin")).toContain("sellerApprovals");
    expect(keys("enumerator")).not.toContain("sellerApprovals");
    expect(keys("agronomist")).not.toContain("users");
  });
});
