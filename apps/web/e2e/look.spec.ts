import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const MOCK_AT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJyb2xlIjoiZmFybWVyIiwiY291bnRyeSI6IkdIIiwiaXNzIjoiYWdyaXByaWNlIiwiZXhwIjo0MTAyNDQ0ODAwfQ.mock-signature";

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

test("theme button switches light ↔ dark on public, auth and app pages", async ({ page }) => {
  const url = new URL(test.info().project.use.baseURL!);
  await page.context().addCookies([{ name: "ap_at", value: MOCK_AT, domain: url.hostname, path: "/", httpOnly: true, sameSite: "Lax" }, { name: "ap_rt", value: "r", domain: url.hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
  for (const path of ["/en", "/en/login", "/en/app"]) {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(path);
    const toDark = page.getByRole("button", { name: "Switch to dark theme" }).first();
    await expect(toDark).toBeVisible({ timeout: 20_000 });
    await toDark.click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByRole("button", { name: "Switch to light theme" }).first().click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  }
});

test("home carousel: five slides, auto-advances, pause and arrows work, axe-clean", async ({ page }) => {
  await page.goto("/en");
  const carousel = page.getByRole("region", { name: "Farming in pictures" });
  await expect(carousel).toBeVisible({ timeout: 20_000 });
  await expect(carousel.locator('[aria-roledescription="slide"]')).toHaveCount(5);
  const current = () => carousel.locator('button[aria-current="true"]').getAttribute("aria-label");
  // Pause first (the pointer may sit over the carousel), then step with the arrows.
  await carousel.getByRole("button", { name: "Pause slideshow" }).click();
  await carousel.getByRole("button", { name: "Next slide" }).click();
  expect(await current()).toBe("Show slide 2");
  await carousel.getByRole("button", { name: "Previous slide" }).click();
  await carousel.getByRole("button", { name: "Previous slide" }).click();
  expect(await current()).toBe("Show slide 5");
  await carousel.getByRole("button", { name: "Show slide 3" }).click();
  expect(await current()).toBe("Show slide 3");
  // Resume with the mouse away: it moves on by itself within ~6 s.
  await carousel.getByRole("button", { name: "Play slideshow" }).click();
  // Interacting holds the slideshow (WCAG 2.2.2); move the pointer and focus away so it can resume.
  await page.mouse.move(1, 1);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect.poll(current, { timeout: 9_000 }).not.toBe("Show slide 3");
  expect(await axe(page)).toEqual([]);
});

test("home carousel stays still when the visitor prefers reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/en");
  const carousel = page.getByRole("region", { name: "Farming in pictures" });
  await expect(carousel.getByRole("button", { name: "Play slideshow" })).toBeVisible({ timeout: 20_000 });
});

test("login and sign-up show their own photo in the brand panel", async ({ page }) => {
  for (const [path, file] of [["/en/login", "login_background"], ["/en/signup", "register_background"]] as const) {
    await page.goto(path);
    // The photo sits in the green brand panel (hidden on phones, where only the form shows).
    const img = page.locator("aside img").first();
    await expect(img).toHaveAttribute("src", new RegExp(file), { timeout: 20_000 });
    expect(await axe(page)).toEqual([]);
  }
});
