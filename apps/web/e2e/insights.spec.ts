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

for (const [path, heading] of [
  ["/en/app/insights", "Insights"],
  ["/en/app/insights/seasonal", "Seasonal price patterns"],
  ["/en/app/insights/recommendations", "Recommendations"],
  ["/en/app/insights/weather?lat=5.6&lng=-0.19", "Weather and crop advice"],
  ["/en/app/insights/planting", "What to plant"],
  ["/en/app/insights/export", "Export insights"],
] as const) {
  test(`${path} renders from the API and is axe-clean`, async ({ page }) => {
    const w = watch(page);
    await signIn(page);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({ timeout: 20_000 });
    expect(await axe(page)).toEqual([]);
    expect(w.failed, "API calls that failed").toEqual([]);
    expect(w.errors, "page errors").toEqual([]);
  });
}

test("recommendations: choosing a market loads advice and alternatives", async ({ page }) => {
  const w = watch(page);
  await signIn(page);
  await page.goto("/en/app/insights/recommendations");
  const select = page.getByRole("combobox", { name: "Select market" });
  await expect(select).toBeVisible({ timeout: 20_000 });
  await select.selectOption({ index: 1 });
  await page.waitForURL(/market=/);
  await expect(page.getByRole("heading", { name: "Better-paying markets nearby" })).toBeVisible({ timeout: 20_000 });
  expect(await axe(page)).toEqual([]);
  expect(w.failed, "API calls that failed").toEqual([]);
});
