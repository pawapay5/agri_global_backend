import { expect, test } from "@playwright/test";

test("landing renders with locale and direction", async ({ page }) => {
  await page.goto("/en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("arabic is right-to-left", async ({ page }) => {
  await page.goto("/ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("signed-in area redirects anonymous visitors to login", async ({ page }) => {
  await page.goto("/en/app");
  await expect(page).toHaveURL(/\/en\/login\?next=/);
});

test("robots.txt blocks private areas", async ({ request }) => {
  const body = await (await request.get("/robots.txt")).text();
  expect(body).toContain("Disallow: /api");
});
