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

test("reports: form validates, then queues a report", async ({ page }) => {
  const w = watch(page);
  await signIn(page);
  await page.goto("/en/app/reports");
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Create report" }).click();
  await expect(page.getByText("Choose at least one commodity.")).toBeVisible();
  await page.getByRole("group", { name: /Commodities/ }).getByRole("checkbox").first().check();
  const posted = page.waitForResponse((r) => r.url().includes("/api/v1/reports") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Create report" }).click();
  expect((await posted).status()).toBe(202);
  expect(await axe(page)).toEqual([]);
  expect(w.failed, "API calls that failed").toEqual([]);
  expect(w.errors, "page errors").toEqual([]);
});

test("data explorer: table from the API, CSV download", async ({ page }) => {
  const w = watch(page);
  await signIn(page);
  await page.goto(`/en/app/data?c=${ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "Data explorer" })).toBeVisible({ timeout: 20_000 });
  const table = page.getByRole("region", { name: "Data explorer" }).or(page.getByText("No prices for this selection."));
  await expect(table).toBeVisible({ timeout: 20_000 });
  if (await page.getByRole("region", { name: "Data explorer" }).isVisible()) {
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download this table (CSV)" }).click();
    expect((await dl).suggestedFilename()).toMatch(/^agriprice-gh-3M-\d{4}-\d{2}-\d{2}\.csv$/);
  }
  expect(await axe(page)).toEqual([]);
  expect(w.failed, "API calls that failed").toEqual([]);
  expect(w.errors, "page errors").toEqual([]);
});
