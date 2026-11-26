import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

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

const json = (r: Route, body: unknown, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const STATUS = {
  enabled: true, translation: true, dailyLimit: 20, usedToday: 2, retentionDays: 90,
  languages: [{ code: "eng", name: "English", voice: false }, { code: "twi", name: "Twi", voice: true }, { code: "ewe", name: "Ewe", voice: true }],
};
const ANSWER = {
  id: "11111111-1111-4111-8111-111111111111", conversationId: "22222222-2222-4222-8222-222222222222", language: "twi", inputMode: "text",
  question: "Aburow boɔ yɛ sɛn wɔ Techiman?", questionEnglish: "How much is maize in Techiman?",
  answer: "Aburow yɛ GHS 4.20 kilo biara wɔ Techiman.", answerEnglish: "Maize is GHS 4.20 per kg in Techiman, seen on 20 November.",
  translated: true, numbersPreserved: false, hasVoice: true, createdAt: "2026-11-26T09:00:00Z",
  facts: [{ kind: "price", commodity: "Maize", market: "Techiman", priceType: "wholesale", amount: "4.20", currency: "GHS", unit: "kg", observedAt: "2026-11-20", changePctWoW: 3.1 }],
};

test("assistant: ask in Twi, see the figures, the English and a warning when a number may have changed", async ({ page }) => {
  await signIn(page);
  const asked: unknown[] = [];
  await page.route("**/api/v1/assistant/status", (r) => json(r, STATUS));
  await page.route("**/api/v1/assistant/messages", async (r) => {
    if (r.request().method() === "POST") { asked.push(r.request().postDataJSON()); return json(r, ANSWER, 201); }
    return json(r, { conversationId: null, data: [] });
  });
  await page.goto("/en/app/assistant");
  await expect(page.getByRole("heading", { level: 1, name: "Ask AgriPrice" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("Language")).toHaveValue("twi");
  await expect(page.getByText("18 of 20 questions left today")).toBeVisible();
  expect(await axe(page)).toEqual([]);

  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Type a question, or tap Speak.")).toBeVisible();
  expect(asked).toEqual([]);

  await page.getByLabel("Your question").fill("Aburow boɔ yɛ sɛn wɔ Techiman?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Aburow yɛ GHS 4.20 kilo biara wɔ Techiman.")).toBeVisible();
  expect(asked).toEqual([{ language: "twi", text: "Aburow boɔ yɛ sɛn wɔ Techiman?" }]);
  await expect(page.getByText(/Maize, Techiman: GH(S|₵)\s?4\.20 \/ kg/)).toBeVisible();
  await expect(page.getByText("The translation may have changed a number.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Show English" }).click();
  await expect(page.getByText(ANSWER.answerEnglish)).toBeVisible();
  await expect(page.getByRole("button", { name: "Listen" })).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test("assistant: translate between English and Ewe", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/v1/assistant/status", (r) => json(r, STATUS));
  await page.route("**/api/v1/assistant/messages", (r) => json(r, { conversationId: null, data: [] }));
  let body: unknown = null;
  await page.route("**/api/v1/assistant/translate", (r) => { body = r.request().postDataJSON(); return json(r, { text: "Bli ƒe asi le dzi yim.", from: "eng", to: "ewe", viaEnglish: false }); });
  await page.goto("/en/app/assistant?tab=translate");
  await expect(page.getByLabel("Text to translate")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("To", { exact: true }).selectOption("ewe");
  await page.getByLabel("Text to translate").fill("The price of maize is going up.");
  await page.getByRole("button", { name: "Translate" }).last().click();
  await expect(page.getByText("Bli ƒe asi le dzi yim.")).toBeVisible();
  expect(body).toEqual({ text: "The price of maize is going up.", from: "eng", to: "ewe" });
  expect(await axe(page)).toEqual([]);
});

test("assistant: explains when it isn't switched on", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/v1/assistant/status", (r) => json(r, { ...STATUS, enabled: false, translation: false, languages: [] }));
  await page.goto("/en/app/assistant");
  await expect(page.getByText("The assistant isn't switched on yet")).toBeVisible({ timeout: 20_000 });
  expect(await axe(page)).toEqual([]);
});
