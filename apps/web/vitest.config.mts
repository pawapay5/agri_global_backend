import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node", // component tests opt in with `// @vitest-environment jsdom` (jsdom 31 → undici 8 fails to load on Node 22.14)
    include: ["src/**/*.test.{ts,tsx}"],
    server: { deps: { inline: ["next-intl"] } },
  },
});
