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
  ["/en/app/alerts", "Price alerts"], ["/en/app/alerts?tab=history", "Price alerts"],
  ["/en/app/notifications", "Notifications"], ["/en/app/settings/notifications", "Notification settings"],
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

test("deleting an alert asks for confirmation first", async ({ page }) => {
  await signIn(page);
  await page.goto("/en/app/alerts");
  const del = page.getByRole("button", { name: /^Delete alert:/ }).first();
  await expect(del).toBeVisible({ timeout: 20_000 });
  await del.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Delete this alert?");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});

test("an invalid WhatsApp number is rejected before saving", async ({ page }) => {
  await signIn(page);
  await page.goto("/en/app/settings/notifications");
  const wa = page.getByLabel("WhatsApp number");
  await expect(wa).toBeVisible({ timeout: 20_000 });
  await wa.fill("024 123");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Enter a number in international format starting with +.")).toBeVisible();
  await expect(wa).toBeFocused();
});
