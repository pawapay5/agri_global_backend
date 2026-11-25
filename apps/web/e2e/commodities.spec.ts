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

function watch(page: Page) {
  const failed: string[] = [], errors: string[] = [];
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  page.on("pageerror", (e) => errors.push(e.message));
  return { failed, errors };
}

test("commodity list → detail tabs → forecast, all from the API and axe-clean", async ({ page }) => {
  test.setTimeout(60_000);
  const w = watch(page);
  await signIn(page);
  await page.goto("/en/app/commodities");
  await page.waitForLoadState("networkidle");
  expect(await axe(page), "list").toEqual([]);

  await page.locator('main a[href*="/app/commodities/"]').first().click();
  await page.waitForURL(/\/app\/commodities\/[^/?]+/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Typical price through the year").first()).toBeVisible({ timeout: 20_000 });
  expect(await axe(page), "overview").toEqual([]);

  for (const [tab, check] of [["Price history", "Summary for this period"], ["Markets", null], ["Forecast", null]] as const) {
    await page.getByRole("radio", { name: tab, exact: true }).click();
    await page.waitForLoadState("networkidle");
    if (check) await expect(page.getByRole("region", { name: check })).toBeVisible({ timeout: 20_000 });
    expect(await axe(page), tab).toEqual([]);
  }
  expect(w.failed, "API calls that failed").toEqual([]);
  expect(w.errors, "page errors").toEqual([]);
});

test("forecast page: market quick-pick sets ?market= and shows horizons", async ({ page }) => {
  const w = watch(page);
  await signIn(page);
  await page.goto("/en/app/forecast");
  await page.waitForLoadState("networkidle");
  await page.locator('main a[href*="/app/forecast/"]').first().click();
  await page.waitForURL(/\/app\/forecast\/[^/?]+/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Choose a market for a forecast")).toBeVisible({ timeout: 20_000 });
  await page.locator("main li button").first().click();
  await page.waitForURL(/market=/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/In 1 month/).first().or(page.getByText("Not enough data for a reliable forecast"))).toBeVisible({ timeout: 20_000 });
  expect(await axe(page)).toEqual([]);
  expect(w.failed, "API calls that failed").toEqual([]);
  expect(w.errors, "page errors").toEqual([]);
});
