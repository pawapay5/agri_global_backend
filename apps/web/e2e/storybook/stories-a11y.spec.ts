import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Entry = { id: string; title: string; name: string; type: string };
const index = JSON.parse(readFileSync(join(process.cwd(), "storybook-static", "index.json"), "utf8")) as { entries: Record<string, Entry> };
const stories = Object.values(index.entries).filter((e) => e.type === "story");

// MarketMap needs live OpenFreeMap tiles; its stories are rendered but axe findings there don't fail the run.
const NETWORK_BOUND = /^agri-marketmap--/;

for (const s of stories) {
  test(`${s.title} › ${s.name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/iframe.html?id=${s.id}&viewMode=story`);
    const root = page.locator("#storybook-root");
    await expect(root).not.toBeEmpty({ timeout: 15_000 });
    await page.waitForTimeout(150); // let ResizeObserver-driven charts settle

    expect(errors, "uncaught errors while rendering").toEqual([]);

    if (NETWORK_BOUND.test(s.id)) return;
    // Storybook's a11y addon also runs axe in the story frame; if ours overlaps it, wait and retry.
    const scan = () => new AxeBuilder({ page }).include("#storybook-root").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    let result: Awaited<ReturnType<typeof scan>> | undefined;
    for (let attempt = 0; !result; attempt++) {
      try { result = await scan(); }
      catch (e) {
        if (attempt >= 4 || !String(e).includes("Axe is already running")) throw e;
        await page.waitForTimeout(500);
      }
    }
    const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  });
}
