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

test("dashboard renders every panel from the API", async ({ page }) => {
  const failed: string[] = [];
  const errors: string[] = [];
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page);
  await page.goto("/en/app");
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
  for (const title of ["Your crops", "Trending commodities", "Your alerts", "Notifications", "Shortcuts"]) {
    await expect(page.getByRole("main").getByText(title, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText("Price records")).toBeVisible();
  expect(failed, "API calls that failed").toEqual([]);
  expect(errors, "page errors").toEqual([]);
});

const PAGES = ["/en", "/en/gh/prices", "/en/gh/prices/tomato", "/en/gh/markets/kumasi-central", "/en/gh/regions", "/en/pricing", "/en/login", "/en/signup"];
for (const path of PAGES) {
  test(`axe: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await axe(page)).toEqual([]);
  });
}

for (const path of ["/en/app", "/en/app/alerts", "/en/app/forecast", "/en/app/commodities", "/en/app/settings/security"]) {
  test(`axe + CSP (signed in): ${path}`, async ({ page }) => {
    // The strict nonce CSP must not block anything we ship (e.g. the theme script allowed by THEME_SCRIPT_HASH).
    const csp: string[] = [];
    page.on("console", (m) => { if (m.type() === "error" && m.text().includes("Content Security Policy")) csp.push(m.text().slice(0, 200)); });
    await signIn(page);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await axe(page)).toEqual([]);
    expect(csp, "CSP violations").toEqual([]);
  });
}
