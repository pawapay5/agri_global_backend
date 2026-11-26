import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const MOCK_AT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJyb2xlIjoiZmFybWVyIiwiY291bnRyeSI6IkdIIiwiaXNzIjoiYWdyaXByaWNlIiwiZXhwIjo0MTAyNDQ0ODAwfQ.mock-signature";
const ID = "497f6eca-6276-4993-bfeb-53cbbbba6f08";

async function signIn(page: Page) {
  const url = new URL(test.info().project.use.baseURL!);
  await page.context().addCookies([
    { name: "ap_at", value: MOCK_AT, domain: url.hostname, path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "ap_rt", value: "mock-refresh-token", domain: url.hostname, path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

function watch(page: Page) {
  const failed: string[] = [], errors: string[] = [];
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  page.on("pageerror", (e) => errors.push(e.message));
  return { failed, errors };
}

const PAGES: [string, RegExp | string][] = [
  ["/en/app/marketplace", "Marketplace"],
  [`/en/app/marketplace/${ID}`, /./],
  ["/en/app/marketplace/saved", "Saved listings"],
  ["/en/app/marketplace/cart", "Cart"],
  ["/en/app/marketplace/orders", "Orders"],
  [`/en/app/marketplace/orders/${ID}`, /^Order #/],
  ["/en/app/marketplace/offers", "Offers"],
  [`/en/app/disputes/${ID}`, "Dispute"],
  ["/en/app/messages", "Messages"],
  [`/en/app/messages/${ID}`, /./],
  ["/en/app/sell", /./],
  ["/en/app/sell/profile", /./],
  ["/en/app/sell/listings", "Listings"],
  ["/en/app/sell/listings/new", "New listing"],
  ["/en/app/sell/offers", "Offers"],
  ["/en/app/sell/orders", "Orders"],
  ["/en/app/sell/wallet", "Wallet"],
  ["/en/app/sell/analytics", "Analytics"],
];

for (const [path, heading] of PAGES) {
  test(`${path} renders from the API and is axe-clean`, async ({ page }) => {
    const w = watch(page);
    await signIn(page);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("main")).toBeVisible({ timeout: 20_000 });
    if (typeof heading === "string" || heading.source !== ".") {
      await expect(page.getByRole("heading", { level: 1, name: heading }).first()).toBeVisible({ timeout: 20_000 });
    }
    expect(await axe(page)).toEqual([]);
    expect(w.failed, "API calls that failed").toEqual([]);
    expect(w.errors, "page errors").toEqual([]);
  });
}

test("phone: the More menu reaches the marketplace", async ({ page }) => {
  test.skip(test.info().project.name !== "mobile", "phone layout only");
  await signIn(page);
  await page.goto("/en/app");
  await page.getByLabel("Menu").click();
  await page.getByRole("link", { name: "Marketplace" }).click();
  await expect(page).toHaveURL(/\/en\/app\/marketplace$/);
});

test("listing: quantity outside the allowed range can't be added to the cart", async ({ page }) => {
  await signIn(page);
  // A buyable listing from someone else (Prism's sample isn't), min order 10, 300 available.
  await page.route(`**/api/v1/marketplace/listings/${ID}`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    id: ID, sellerId: "11111111-1111-4111-8111-111111111111", seller: { displayName: "Kofi Farms", verified: true }, type: "product", title: "Fresh tomatoes",
    pricePerUnit: "12.50", currency: "GHS", unit: "kg", quantity: "300", minOrderQty: "10", status: "active", photos: [], favourite: false, createdAt: "2026-11-01T00:00:00Z",
  }) }));
  await page.goto(`/en/app/marketplace/${ID}`);
  const qty = page.getByLabel(/^Quantity/);
  await expect(qty).toBeVisible({ timeout: 20_000 });
  await qty.fill("5");
  await expect(page.getByText(/^Enter between/)).toBeVisible();
  await qty.fill("999999999");
  await expect(page.getByText(/^Enter between/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to cart" })).toBeDisabled();
});

test("new listing: validation blocks an empty form and focuses the first problem", async ({ page }) => {
  await signIn(page);
  await page.goto("/en/app/sell/listings/new");
  await page.getByRole("button", { name: "Save as draft" }).click();
  await expect(page.getByLabel("Title")).toBeFocused();
  await expect(page.getByText("Required.").first()).toBeVisible();
});
