import type { Pool } from "pg";
import type { Logger } from "pino";

/**
 * Hard-deletes accounts whose 30-day grace period has ended.
 * Contributed prices are kept (they are public-interest market data) but anonymised:
 * submitter, GPS point and free-text note are removed first.
 */
export async function purgeDeletedAccounts(db: Pool, log: Logger, batch = 100): Promise<number> {
  const due = (await db.query<{ id: string }>(
    `SELECT id FROM users WHERE deletion_scheduled_at IS NOT NULL AND deletion_scheduled_at <= now() ORDER BY deletion_scheduled_at LIMIT $1`, [batch])).rows;
  for (const { id } of due) {
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      // Re-check under lock: the user may have cancelled by signing in.
      const still = await c.query(`SELECT 1 FROM users WHERE id = $1 AND deletion_scheduled_at <= now() FOR UPDATE`, [id]);
      if (!still.rowCount) { await c.query("ROLLBACK"); continue; }
      const anonymised = await c.query(
        `UPDATE price_observations SET submitted_by = NULL, location = NULL, note = NULL, idempotency_key = NULL WHERE submitted_by = $1`, [id]);
      await c.query(`UPDATE price_observations SET reviewed_by = NULL WHERE reviewed_by = $1`, [id]);
      await c.query(`UPDATE price_import_batches SET uploaded_by = NULL WHERE uploaded_by = $1`, [id]);
      // Everything else cascades (devices, tokens, prefs, locations, consents, alerts, notifications).
      await c.query(`DELETE FROM users WHERE id = $1`, [id]);
      // The audit trail keeps the action but not the identity of the person.
      await c.query(`INSERT INTO audit_log (actor_id, action, entity, data) VALUES (NULL, 'account.hard_deleted', 'user', $1)`,
        [{ anonymisedPrices: anonymised.rowCount }]);
      await c.query(`UPDATE audit_log SET actor_id = NULL, ip = NULL, user_agent = NULL WHERE actor_id = $1`, [id]);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => undefined);
      log.error({ err: e }, "account purge failed");
    } finally {
      c.release();
    }
  }
  if (due.length) log.info({ purged: due.length }, "accounts purged");
  return due.length;
}
