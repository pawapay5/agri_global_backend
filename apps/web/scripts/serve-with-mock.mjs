import { spawn } from "node:child_process";

const PORT = Number(process.argv[2] ?? 3100), PRISM = 4010;
const shell = process.platform === "win32";
const kids = [];
const run = (cmd, args, env = {}) => {
  const p = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, ...env }, shell });
  kids.push(p);
  p.on("exit", (code) => { if (code && code !== 0) { console.error(`${cmd} exited with ${code}`); stop(1); } });
  return p;
};
const stop = (code = 0) => { for (const k of kids) k.kill(); process.exit(code); };
process.on("SIGINT", () => stop()); process.on("SIGTERM", () => stop());

const up = async (url, ms = 90_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${url}`);
};

run("npx", ["prism", "mock", "../../openapi/openapi.yaml", "-p", String(PRISM), "-h", "127.0.0.1", "--errors"]);
await up(`http://127.0.0.1:${PRISM}/v1/countries`);
run("npx", ["next", "start", "--port", String(PORT)], { AGRIPRICE_API_URL: `http://127.0.0.1:${PRISM}`, NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}` });
await up(`http://localhost:${PORT}/api/health`);
console.log(`Ready on http://localhost:${PORT} (API mocked by Prism on :${PRISM})`);
