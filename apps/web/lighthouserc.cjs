/**
 * Lighthouse CI for the public pages: mobile preset, simulated slow 4G and a mid-range CPU (Lighthouse defaults),
 * against a production build whose API is the Prism mock (see playwright.config.ts for the same setup).
 * Run: pnpm build && pnpm lhci   (CHROME_PATH may point at Playwright's Chromium).
 *
 * Budgets from the web spec: LCP < 2.5 s, CLS < 0.1, a11y ≥ 0.95. INP needs real interaction, so total blocking
 * time stands in for it in the lab. Script weight: framework + ≤ 50 KB first-party (docs/design-system.md),
 * asserted as ≤ 210 KB of script transferred until the total-budget question is settled.
 */
const PORT = 3100;
const pages = ["/en", "/en/gh/prices", "/en/gh/prices/maize-white", "/en/gh/markets/kumasi-central", "/en/gh/regions/ah", "/en/methodology", "/fr/gh/prices"];

module.exports = {
  ci: {
    collect: {
      url: pages.map((p) => `http://localhost:${PORT}${p}`),
      numberOfRuns: 3,
      startServerCommand: `node scripts/serve-with-mock.mjs ${PORT}`,
      startServerReadyPattern: "Ready",
      startServerReadyTimeout: 60_000,
      settings: { preset: undefined, formFactor: "mobile", screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false }, throttlingMethod: "simulate", chromeFlags: "--headless=new --no-sandbox" },
    },
    assert: {
      assertions: {
        "categories:performance": ["warn", { minScore: 0.9 }],
        "categories:accessibility": ["error", { minScore: 0.95 }],
        "categories:best-practices": ["warn", { minScore: 0.9 }],
        "categories:seo": ["error", { minScore: 0.95 }],
        "largest-contentful-paint": ["error", { maxNumericValue: 2500 }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],
        "total-blocking-time": ["warn", { maxNumericValue: 200 }],
        "resource-summary:script:size": ["warn", { maxNumericValue: 210_000 }],
      },
    },
    upload: { target: "filesystem", outputDir: "./.lighthouseci" },
  },
};
