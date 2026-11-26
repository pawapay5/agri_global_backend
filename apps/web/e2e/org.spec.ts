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

for (const path of ["/en/app/org", "/en/app/developers", "/en/app/org/join?token=abcdefghijklmnop1234"]) {
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

test("a new API key's secret is shown once, then gone", async ({ page }) => {
  await signIn(page);
  await page.goto("/en/app/developers");
  await page.getByLabel("Key name").fill("Reporting dashboard");
  await page.getByRole("button", { name: "Create key" }).click();
  const dialog = page.getByRole("dialog", { name: "Copy your new key now" });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  const secret = (await dialog.locator("code").textContent())?.trim() ?? "";
  expect(secret.length).toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "I've stored it" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(secret, { exact: true })).toHaveCount(0);
});

test("joining an organisation needs a click (a link alone changes nothing)", async ({ page }) => {
  let accepted = false;
  page.on("request", (r) => { if (r.url().includes("/api/v1/org/invites/accept")) accepted = true; });
  await signIn(page);
  await page.goto("/en/app/org/join?token=abcdefghijklmnop1234");
  await expect(page.getByRole("button", { name: "Join an organisation" })).toBeVisible({ timeout: 20_000 });
  expect(accepted).toBe(false);
});
