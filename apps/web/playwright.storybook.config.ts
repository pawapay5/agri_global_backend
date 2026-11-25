import { defineConfig, devices } from "@playwright/test";

const PORT = 6007;

export default defineConfig({
  testDir: "./e2e/storybook",
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, ...devices["Desktop Chrome"] },
  webServer: {
    command: `npx vite preview --outDir storybook-static --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/index.json`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
