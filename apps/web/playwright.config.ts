import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a production build (`pnpm build` first) with the API mocked by Prism from
 * openapi/openapi.yaml. Prism also validates every request the BFF sends against the contract, so a
 * malformed call fails the test. Port 3100 keeps it clear of a running `next dev` on 3000.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const PRISM = 4010;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["storybook/**"],
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: `npx prism mock ../../openapi/openapi.yaml -p ${PRISM} -h 127.0.0.1`,
      url: `http://127.0.0.1:${PRISM}/v1/countries`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `npx next start --port ${PORT}`,
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { AGRIPRICE_API_URL: `http://127.0.0.1:${PRISM}`, NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}` },
    },
  ],
});
