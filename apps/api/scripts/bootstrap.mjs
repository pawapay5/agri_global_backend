#!/usr/bin/env node
// One-shot deploy bootstrap (the `migrate` service on Coolify). Safe to run on every deploy:
//   1. apply pending migrations;
//   2. load each country in SEED_COUNTRIES (default "gh") that isn't in the database yet. Countries already
//      loaded are skipped, so edits made in the admin console are never overwritten by the pack;
//   3. create or confirm the admin from ADMIN_EMAIL / ADMIN_PASSWORD (skipped when unset).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { seedAdmin } from "./seed-admin.mjs";
import { seedCountries } from "./seed-admin.lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const run = (file, args) => {
  const r = spawnSync(process.execPath, [file, ...args], { stdio: "inherit", env: process.env });
  if (r.status !== 0) throw new Error(`${file} ${args.join(" ")} exited with ${r.status}`);
};

run(join(here, "migrate.mjs"), ["up"]);

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const wanted = seedCountries(process.env);
  const missing = [];
  for (const iso of wanted) {
    const r = await db.query("SELECT 1 FROM countries WHERE iso2 = $1", [iso.toUpperCase()]);
    if (!r.rowCount) missing.push(iso);
  }
  if (missing.length) {
    const cli = join(here, "..", "dist", "seed", "seed.cli.js");
    if (!existsSync(cli)) throw new Error(`country seed not built (${cli}); run the API build first`);
    console.log(`bootstrap: loading countries ${missing.join(", ")}`);
    run(cli, missing);
  } else {
    console.log(wanted.length ? `bootstrap: countries ${wanted.join(", ")} already loaded` : "bootstrap: country seeding off (SEED_COUNTRIES=none)");
  }
  await seedAdmin(db);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await db.end();
}
