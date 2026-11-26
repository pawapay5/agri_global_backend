import { defineConfig, devices } from "@playwright/test";

/**
 * Admin console e2e. Same setup as playwright.config.ts, but Prism serves a copy of the contract whose generated
 * user is an admin (scripts/admin-mock-spec.mjs), because the admin layout checks the role server-side.
 * Run after `pnpm build`: npx playwright test -c playwright.admin.config.ts
 */
const PORT = 3101;
const PRISM = 4011;
const SPEC = ".admin-mock.openapi.yaml";

export default defineConfig({
  testDir: "./e2e-admin",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: `node scripts/admin-mock-spec.mjs ${SPEC} && npx prism mock ${SPEC} -p ${PRISM} -h 127.0.0.1`,
      url: `http://127.0.0.1:${PRISM}/v1/countries`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npx next start --port ${PORT}`,
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { AGRIPRICE_API_URL: `http://127.0.0.1:${PRISM}`, NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}` },
    },
  ],
});
