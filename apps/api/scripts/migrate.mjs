#!/usr/bin/env node
// Minimal reversible migration runner.
//   node scripts/migrate.mjs up [--to 0004]     apply pending migrations
//   node scripts/migrate.mjs down [--steps 1]   roll back the last N migrations
//   node scripts/migrate.mjs status
// Files: migrations/NNNN_name.up.sql + NNNN_name.down.sql (both required).
// A first line of `-- migrate:no-transaction` runs the file outside a transaction
// (needed for TimescaleDB continuous aggregates).
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import pg from "pg";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const [cmd = "status", ...rest] = process.argv.slice(2);
const flag = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };

function load() {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  const ids = [...new Set(files.map((f) => f.replace(/\.(up|down)\.sql$/, "")))].sort();
  return ids.map((id) => {
    const up = join(dir, `${id}.up.sql`), down = join(dir, `${id}.down.sql`);
    if (!files.includes(`${id}.up.sql`) || !files.includes(`${id}.down.sql`))
      throw new Error(`Migration ${id} must have both .up.sql and .down.sql`);
    const upSql = readFileSync(up, "utf8");
    return { id, upSql, downSql: readFileSync(down, "utf8"), checksum: createHash("sha256").update(upSql).digest("hex") };
  });
}

const noTx = (sql) => /^\s*--\s*migrate:no-transaction/.test(sql);

async function run(client, sql, bookkeeping) {
  if (noTx(sql)) {
    // Execute statements one at a time (CAGG DDL refuses multi-statement implicit transactions).
    for (const stmt of splitSql(sql)) await client.query(stmt);
    await client.query(bookkeeping.text, bookkeeping.values);
  } else {
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(bookkeeping.text, bookkeeping.values);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; }
  }
}

// Splits on semicolons outside quotes, dollar-quotes and comments.
function splitSql(sql) {
  const out = []; let cur = ""; let i = 0; let dollar = null; let q = null;
  while (i < sql.length) {
    const c = sql[i], n = sql[i + 1];
    if (!q && !dollar && c === "-" && n === "-") { const e = sql.indexOf("\n", i); i = e < 0 ? sql.length : e + 1; cur += "\n"; continue; }
    if (!q && c === "$") { const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i)); if (m) { if (dollar === m[0]) dollar = null; else if (!dollar) dollar = m[0]; cur += m[0]; i += m[0].length; continue; } }
    if (!dollar && (c === "'" || c === '"')) { if (q === c) q = null; else if (!q) q = c; }
    if (!q && !dollar && c === ";") { if (cur.trim()) out.push(cur.trim()); cur = ""; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const url = process.env.DATABASE_URL ?? "postgres://agriprice:agriprice@localhost:5432/agriprice";

/**
 * Connect with retries. On a fresh volume the Postgres image runs initdb, then restarts; a container
 * orchestrator can start us in that window. Retry connection-level failures for up to ~90 s (MIGRATE_CONNECT_TIMEOUT_S).
 * Auth/database errors aren't retried: they won't fix themselves.
 */
async function connectWithRetry() {
  const deadline = Date.now() + Number(process.env.MIGRATE_CONNECT_TIMEOUT_S ?? 90) * 1000;
  const transient = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "57P03" /* cannot_connect_now: starting up */]);
  for (let attempt = 1; ; attempt++) {
    const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
    try {
      await c.connect();
      await c.query("SELECT 1");
      return c;
    } catch (e) {
      await c.end().catch(() => {});
      const code = e.code ?? "";
      const retry = transient.has(code) || /terminat|shutting down|Connection terminated|timeout/i.test(e.message);
      if (!retry || Date.now() > deadline) {
        const host = (() => { try { const u = new URL(url); return `${u.hostname}:${u.port || 5432}/${u.pathname.slice(1)}`; } catch { return "?"; } })();
        console.error(`migrate: cannot connect to ${host}: ${code} ${e.message}`);
        throw e;
      }
      console.log(`migrate: database not ready (${code || e.message}); retry ${attempt}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

const client = await connectWithRetry();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  await client.query("SELECT pg_advisory_lock(727274)");
  const applied = new Map((await client.query("SELECT id, checksum FROM schema_migrations ORDER BY id")).rows.map((r) => [r.id, r.checksum]));
  const all = load();
  for (const m of all) if (applied.has(m.id) && applied.get(m.id) !== m.checksum) console.warn(`! ${m.id} changed after being applied`);

  if (cmd === "status") {
    for (const m of all) console.log(`${applied.has(m.id) ? "[x]" : "[ ]"} ${m.id}`);
  } else if (cmd === "up") {
    const to = flag("--to");
    for (const m of all) {
      if (applied.has(m.id)) continue;
      if (to && m.id.slice(0, to.length) > to) break;
      process.stdout.write(`↑ ${m.id} ... `);
      await run(client, m.upSql, { text: "INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)", values: [m.id, m.checksum] });
      console.log("ok");
    }
  } else if (cmd === "down") {
    const steps = Number(flag("--steps") ?? 1);
    const targets = all.filter((m) => applied.has(m.id)).reverse().slice(0, steps);
    for (const m of targets) {
      process.stdout.write(`↓ ${m.id} ... `);
      await run(client, m.downSql, { text: "DELETE FROM schema_migrations WHERE id = $1", values: [m.id] });
      console.log("ok");
    }
  } else {
    throw new Error(`Unknown command ${cmd}`);
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(727274)").catch(() => {});
  await client.end();
}
