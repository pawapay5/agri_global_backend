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

const PAGES = [
  "/en/app/community", `/en/app/community/posts/${ID}`, `/en/app/community/users/${ID}`,
  "/en/app/tools", "/en/app/tools/fertiliser", "/en/app/tools/report-price", "/en/app/tools/pests", `/en/app/tools/pests/${ID}`,
  "/en/app/tools/guides", `/en/app/tools/guides/${ID}`, "/en/app/tools/programmes", "/en/app/tools/training", "/en/app/tools/suppliers", "/en/app/tools/market-intel",
];

for (const path of PAGES) {
  test(`${path} renders from the API and is axe-clean`, async ({ page }) => {
    const w = watch(page);
    await signIn(page);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
    expect(await axe(page)).toEqual([]);
    expect(w.failed, "API calls that failed").toEqual([]);
    expect(w.errors, "page errors").toEqual([]);
  });
}

test("fertiliser calculator shows a plan with its safety note", async ({ page }) => {
  await signIn(page);
  await page.goto("/en/app/tools/fertiliser");
  await page.getByLabel("Farm size").fill("2");
  await page.getByRole("button", { name: "Calculate" }).click();
  await expect(page.getByRole("heading", { name: "Your fertiliser plan" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^Safety:/)).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test("composer: a price update without a price is stopped before posting", async ({ page }) => {
  await signIn(page);
  await page.goto("/en/app/community");
  await page.getByRole("radio", { name: "Price update" }).first().click();
  await page.getByLabel("What would you like to share?").fill("Tomatoes at Kumasi today");
  let posted = false;
  page.on("request", (r) => { if (r.url().includes("/api/v1/community/posts") && r.method() === "POST") posted = true; });
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page.getByText("Add the market and price for a price update.")).toBeVisible();
  expect(posted).toBe(false);
});
