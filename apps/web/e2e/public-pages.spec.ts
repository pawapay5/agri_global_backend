import { expect, test } from "@playwright/test";

/** Every public page renders, carries SEO metadata, and unknown slugs get a real 404 (API mocked by Prism). */
const PAGES = [
  "/en/gh/prices", "/en/gh/prices/tomato", "/en/gh/markets", "/en/gh/markets/kumasi-central", "/en/gh/regions", "/en/gh/regions/ah",
  "/en/gh/marketplace", "/en/guides", "/en/guides/tomato", "/en/pests", "/en/help", "/en/stories", "/en/methodology", "/en/about",
  "/en/pricing", "/en/contact", "/en/legal/privacy", "/en/legal/terms", "/en/status",
];

for (const path of PAGES) {
  test(`${path} renders with SEO metadata`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${path}$`));
    expect(await page.locator('link[rel="alternate"][hreflang]').count()).toBeGreaterThanOrEqual(10); // 9 locales + x-default
  });
}

test("market page has Place and BreadcrumbList JSON-LD", async ({ page }) => {
  await page.goto("/en/gh/markets/kumasi-central");
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).flatMap((s) => {
    const j = JSON.parse(s); return (Array.isArray(j) ? j : [j]).map((x: { "@type": string }) => x["@type"]);
  });
  expect(types).toEqual(expect.arrayContaining(["Place", "BreadcrumbList"]));
});

for (const path of ["/en/gh/markets/nowhere", "/en/gh/prices/not-a-crop", "/en/gh/regions/xx", "/en/zz/prices", "/en/guides/not-a-crop"]) {
  test(`${path} is a real 404`, async ({ request }) => {
    expect((await request.get(path)).status()).toBe(404);
  });
}

test("sitemaps list the new pages", async ({ request }) => {
  const gh = await (await request.get("/sitemap/gh.xml")).text();
  expect(gh).toContain("/en/gh/markets/kumasi-central");
  expect(gh).toContain("/en/gh/regions/ah");
  const site = await (await request.get("/sitemap/site.xml")).text();
  expect(site).toContain("/en/methodology");
});
