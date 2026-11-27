import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Token claims say admin too (proxy.ts uses them as a hint); the layout's real check is GET /v1/me on the mock.
const MOCK_AT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJyb2xlIjoiYWRtaW4iLCJjb3VudHJ5IjoiR0giLCJpc3MiOiJhZ3JpcHJpY2UiLCJleHAiOjQxMDI0NDQ4MDB9.mock-signature";

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

const PAGES = ["/en/admin", "/en/admin/prices/review", "/en/admin/prices/import", "/en/admin/catalogue", "/en/admin/countries", "/en/admin/users",
  "/en/admin/moderation", "/en/admin/disputes", "/en/admin/payouts", "/en/admin/reconciliation", "/en/admin/broadcasts", "/en/admin/models", "/en/admin/audit", "/en/admin/kyc"];

for (const path of PAGES) {
  test(`${path} renders from the API and is axe-clean`, async ({ page }) => {
    const failed: string[] = [], errors: string[] = [], csp: string[] = [];
    page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && m.text().includes("Content Security Policy")) csp.push(m.text().slice(0, 160)); });
    await signIn(page);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(new RegExp(`${path.replace(/\//g, "\\/")}$`));
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
    expect(await axe(page)).toEqual([]);
    expect(failed, "API calls that failed").toEqual([]);
    expect(errors, "page errors").toEqual([]);
    expect(csp, "CSP violations").toEqual([]);
  });
}

test("price import stays locked until a dry run has checked the file", async ({ page }) => {
  await signIn(page);
  await page.goto("/en/admin/prices/import");
  await expect(page.getByRole("button", { name: "Import", exact: true })).toBeDisabled({ timeout: 20_000 });
});

test("catalogue editor rejects invalid JSON before sending", async ({ page }) => {
  await signIn(page);
  await page.goto("/en/admin/catalogue");
  await page.getByRole("button", { name: "New row" }).click();
  const dialog = page.getByRole("dialog");
  let sent = false;
  page.on("request", (r) => { if (r.url().includes("/api/v1/admin/tables/") && r.method() === "POST") sent = true; });
  await dialog.getByLabel("JSON").fill("{ not json");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByText(/^That isn't valid JSON/)).toBeVisible();
  expect(sent).toBe(false);
});

test("anonymous visitors are sent to sign in", async ({ page, context }) => {
  // Same server, but no session at all: the layout sends the visitor to sign in.
  await context.clearCookies();
  await page.goto("/en/admin/users");
  await expect(page).toHaveURL(/\/en\/login/);
});

test("staff get an Admin console link in the app sidebar", async ({ page }) => {
  await signIn(page);
  await page.goto("/en/app");
  const link = page.getByRole("link", { name: "Admin console" }).first();
  if (test.info().project.name === "mobile") await page.getByLabel("Menu").click();
  await expect(link).toBeVisible({ timeout: 20_000 });
  await link.click();
  await expect(page).toHaveURL(/\/en\/admin$/);
});

test("seller approvals: rejecting needs a reason, approving asks first", async ({ page }) => {
  await signIn(page);
  await page.route("https://example.com/**", (r) => r.fulfill({ status: 200, contentType: "image/svg+xml", body: "<svg xmlns='http://www.w3.org/2000/svg'/>" }));
  const decisions: unknown[] = [];
  await page.route("**/api/v1/admin/kyc/*/decision", async (r) => { decisions.push(r.request().postDataJSON()); await r.fulfill({ status: 204 }); });
  await page.goto("/en/admin/kyc");
  await expect(page.getByRole("heading", { name: "Seller approvals", level: 1 })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Reject" }).first().click();
  await page.getByRole("button", { name: "Reject" }).first().click();
  await expect(page.getByText(/Write a reason of at least 5 characters/)).toBeVisible();
  expect(decisions).toEqual([]);
  await page.getByRole("button", { name: "Cancel" }).first().click();
  await page.getByRole("button", { name: "Approve" }).first().click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Approve" }).click();
  await expect.poll(() => decisions).toEqual([{ decision: "approve" }]);
});

test("users: admins add people, including an org admin, and an invitation is sent", async ({ page }) => {
  await signIn(page);
  let body: unknown = null;
  await page.route("**/api/v1/admin/users", async (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    body = r.request().postDataJSON();
    await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000009", email: "kofi@example.com", role: "org_admin", country: "GH" }) });
  });
  await page.goto("/en/admin/users");
  await page.getByRole("button", { name: "Add user" }).first().click();
  await page.getByRole("button", { name: "Add and send invitation" }).click();
  await expect(page.locator("#nu-fullName")).toBeFocused();
  expect(body).toBeNull();
  await page.locator("#nu-fullName").fill("Kofi Boateng");
  await page.locator("#nu-email").fill("kofi@example.com");
  await page.locator("#nu-role").selectOption("org_admin");
  await page.getByRole("button", { name: "Add and send invitation" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Add user" }).click();
  await expect(page.getByText("Added. An invitation was sent to kofi@example.com.", { exact: true })).toBeVisible();
  expect(body).toMatchObject({ fullName: "Kofi Boateng", email: "kofi@example.com", role: "org_admin" });
});
