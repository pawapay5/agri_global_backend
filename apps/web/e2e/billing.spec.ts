import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const MOCK_AT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJyb2xlIjoiZmFybWVyIiwiY291bnRyeSI6IkdIIiwiaXNzIjoiYWdyaXByaWNlIiwiZXhwIjo0MTAyNDQ0ODAwfQ.mock-signature";

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

test("billing renders plan, entitlements and plans from the API", async ({ page }) => {
  const failed: string[] = [], errors: string[] = [];
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page);
  await page.goto("/en/app/billing");
  await expect(page.getByRole("heading", { level: 1, name: "Plan & billing" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("What your plan includes")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Plans" })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  expect(failed, "API calls that failed").toEqual([]);
  expect(errors, "page errors").toEqual([]);
});

test("checkout never opens an untrusted payment page", async ({ page }) => {
  await signIn(page);
  // The mock's example authorizationUrl isn't a provider domain: the page must refuse to navigate there.
  // Prism's generated plan list has no paid plan; give this test a free and a premium plan to upgrade between.
  const ent = { forecast_horizons: [1], history_range: ["1M"], alerts_max: 3 };
  await page.route("**/api/v1/billing/plans**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([
    { code: "free", name: { en: "Free" }, entitlements: ent },
    { code: "premium", name: { en: "Premium" }, prices: { GHS: { monthly: "50", yearly: "500" } }, entitlements: { ...ent, forecast_horizons: [1, 3, 6] } },
  ]) }));
  await page.route("**/api/v1/billing/subscription", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ plan: "free", source: "none", subscription: null, entitlements: ent }) }));
  await page.route("**/api/v1/billing/checkout", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ provider: "paystack", reference: "sub_x", authorizationUrl: "https://paystack.com.evil.example/pay" }) }));
  await page.goto("/en/app/billing");
  const upgrade = page.getByRole("button", { name: "Upgrade to Premium" });
  await expect(upgrade).toBeVisible({ timeout: 20_000 });
  await upgrade.click();
  // The toast text also appears in its screen-reader live region, hence first().
  await expect(page.getByText("The payment page address wasn't recognised").first()).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/en/app/billing");
});
