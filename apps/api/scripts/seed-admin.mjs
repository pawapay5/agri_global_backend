import argon2 from "argon2";
import pg from "pg";
import { readAdminConfig } from "./seed-admin.lib.mjs";

// Same parameters as src/modules/auth/credentials.ts (OWASP 2024 argon2id baseline).
const ARGON = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export async function seedAdmin(db, env = process.env, log = console.log) {
  const cfg = readAdminConfig(env, (env.SEED_COUNTRIES ?? "gh").split(",")[0]);
  if ("skip" in cfg) { log(`admin seed: skipped (${cfg.skip})`); return "skipped"; }
  if ("error" in cfg) throw new Error(`admin seed: ${cfg.error}`);

  const country = await db.query("SELECT 1 FROM countries WHERE iso2 = $1", [cfg.country]);
  if (!country.rowCount) throw new Error(`admin seed: country ${cfg.country} isn't loaded yet; set SEED_COUNTRIES to include it or set ADMIN_COUNTRY`);

  const existing = await db.query("SELECT id, role FROM users WHERE email = $1", [cfg.email]);
  if (existing.rowCount) {
    const { id, role } = existing.rows[0];
    const sets = ["role = 'admin'", "email_verified_at = coalesce(email_verified_at, now())"];
    const args = [id];
    if (cfg.reset) { args.push(await argon2.hash(cfg.password, ARGON)); sets.push(`password_hash = $${args.length}`, "password_changed_at = now()"); }
    await db.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $1`, args);
    await audit(db, id, "admin.seed.updated", { previousRole: role, passwordReset: cfg.reset });
    log(`admin seed: ${cfg.email} already exists; role is admin${cfg.reset ? ", password reset" : " (password unchanged)"}`);
    return "updated";
  }

  const hash = await argon2.hash(cfg.password, ARGON);
  const { rows } = await db.query(
    `INSERT INTO users (email, email_verified_at, password_hash, password_changed_at, full_name, role, country_iso2)
     VALUES ($1, now(), $2, now(), $3, 'admin', $4) RETURNING id`,
    [cfg.email, hash, cfg.name, cfg.country]);
  await audit(db, rows[0].id, "admin.seed.created", { country: cfg.country });
  log(`admin seed: created admin ${cfg.email}`);
  return "created";
}

async function audit(db, userId, action, data) {
  // Best effort: the account matters more than its audit line.
  await db.query(`INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES (NULL, $1, 'user', $2, $3)`, [action, userId, data]).catch(() => undefined);
}

// Run directly (not when imported by bootstrap.mjs or tests).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("seed-admin.mjs")) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try { await seedAdmin(db); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; } finally { await db.end(); }
}
