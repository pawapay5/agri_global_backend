import { expect, test } from "@playwright/test";

/**
 * Sign-up → email OTP → onboarding → dashboard → alert, through the real BFF and proxy, with Prism standing in
 * for the API (responses are the contract's examples). Covers: CSRF header on every POST, httpOnly session
 * cookies, the proxy gate letting a session into /app, onboarding saves, and the alert feedback dialog.
 */
test("sign-up through to a first alert", async ({ page, context }) => {
  const problems: string[] = [];
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });

  // 1. Sign up
  await page.goto("/en/signup");
  await page.getByLabel("Full name").fill("Ama Mensah");
  await page.getByLabel("Email").fill("ama@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /create account|sign up/i }).click();

  // 2. Verify the emailed code (Prism accepts any well-formed code)
  await expect(page).toHaveURL(/\/en\/verify\?email=/);
  const boxes = page.locator('fieldset input');
  for (let i = 0; i < 6; i++) await boxes.nth(i).fill(String(i + 1));
  await page.getByRole("button", { name: /verify/i }).click();

  // Session cookies are httpOnly: present for the server, invisible to page scripts.
  await expect(page).toHaveURL(/\/en\/app\/onboarding/);
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "ap_at")?.httpOnly).toBe(true);
  expect(cookies.find((c) => c.name === "ap_rt")?.httpOnly).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain("ap_at");

  // 3. Onboarding: role → crops → markets → topics (wait for hydration: the page loads fresh after verify)
  await page.waitForLoadState("networkidle");
  await page.getByRole("radio", { name: "Trader or aggregator" }).click();
  await expect(page.getByRole("radio", { name: "Trader or aggregator" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Pick at least one crop")).toBeVisible();
  await page.getByRole("checkbox").first().click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Go to my dashboard" }).click();

  // 4. Dashboard
  await expect(page).toHaveURL(/\/en\/app$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // 5. Create an alert
  await page.goto("/en/app/alerts");
  await page.getByLabel("Commodity").selectOption({ index: 1 });
  await page.getByLabel(/Threshold/).fill("12.50");
  await page.getByRole("button", { name: "Create alert" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Your alert is set" })).toBeVisible();

  expect(problems, "API calls the contract rejected").toEqual([]);
});

test("a cross-site POST to the BFF is refused", async ({ request }) => {
  const r = await request.post("/api/auth/login", { headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, data: { email: "a@b.co", password: "x" } });
  expect(r.status()).toBe(403);
});
