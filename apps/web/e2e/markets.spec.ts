import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const MOCK_AT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJyb2xlIjoiZmFybWVyIiwiY291bnRyeSI6IkdIIiwiaXNzIjoiYWdyaXByaWNlIiwiZXhwIjo0MTAyNDQ0ODAwfQ.mock-signature";

/** Map tiles come from OpenFreeMap over the internet; tests stay offline and deterministic without them. */
async function noTiles(page: Page) {
  await page.route((url) => url.hostname === "tiles.openfreemap.org", (r) => r.abort());
}

async function signIn(page: Page) {
  await noTiles(page);
  const url = new URL(test.info().project.use.baseURL!);
  await page.context().addCookies([
    { name: "ap_at", value: MOCK_AT, domain: url.hostname, path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "ap_rt", value: "mock-refresh-token", domain: url.hostname, path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).exclude(".maplibregl-canvas-container").exclude(".maplibregl-ctrl").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

function watch(page: Page) {
  const failed: string[] = [], errors: string[] = [];
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  page.on("pageerror", (e) => errors.push(e.message));
  return { failed, errors };
}

for (const [path, heading] of [["/en/app/markets/map", "Market map"], ["/en/app/markets/heatmap", "Regional price heatmap"], ["/en/app/markets/nearby", "Markets near you"]] as const) {
  test(`${path} renders from the API and is axe-clean`, async ({ page }) => {
    const w = watch(page);
    await signIn(page);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("navigation", { name: "Market views" }).getByRole("link", { name: /Map|Heatmap|Nearby/ }).first()).toBeVisible();
    expect(await axe(page)).toEqual([]);
    expect(w.failed, "API calls that failed").toEqual([]);
    expect(w.errors, "page errors").toEqual([]);
  });
}

test("nearby: shared location is rounded before it reaches the URL", async ({ page, context }) => {
  test.setTimeout(60_000);
  const w = watch(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 5.603716, longitude: -0.186964 });
  await signIn(page);
  await page.goto("/en/app/markets/nearby");
  await page.getByRole("button", { name: "Use my location" }).click();
  await page.waitForURL(/lat=5\.6&lng=-0\.19/, { timeout: 20_000 });
  await expect(page.getByText("Searching from your location")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Markets near you" }).or(page.getByText(/No markets within/))).toBeVisible({ timeout: 20_000 });
  expect(await axe(page)).toEqual([]);
  expect(w.failed, "API calls that failed").toEqual([]);
  expect(w.errors, "page errors").toEqual([]);
});
