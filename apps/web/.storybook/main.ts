import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/nextjs-vite";
import tailwindcss from "@tailwindcss/vite";

// Windows: a lowercase drive in the working directory ("c:\…", common in Git Bash and some editors) makes
// Storybook key its story importers by absolute path ("./C:/…") while the index uses "./src/…", so every
// story fails with "importFn is not a function". Normalise the drive letter before Storybook reads cwd.
if (process.platform === "win32" && /^[a-z]:/.test(process.cwd())) {
  process.chdir(process.cwd()[0]!.toUpperCase() + process.cwd().slice(1));
}

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-themes"],
  framework: { name: "@storybook/nextjs-vite", options: {} },
  staticDirs: ["../public"],
  core: { disableTelemetry: true },
  async viteFinal(cfg) {
    cfg.plugins = [...(cfg.plugins ?? []), tailwindcss()];
    cfg.resolve = { ...cfg.resolve, alias: { ...(cfg.resolve?.alias as Record<string, string> | undefined), "@": fileURLToPath(new URL("../src", import.meta.url)) } };
    return cfg;
  },
};

export default config;
