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
      const financial = await c.query(
        `SELECT 1 FROM orders WHERE buyer_id = $1 OR seller_id = $1 UNION ALL SELECT 1 FROM payouts WHERE seller_id = $1 UNION ALL SELECT 1 FROM payments WHERE payer_id = $1 LIMIT 1`, [id]);
      if (financial.rowCount) {
        // Orders, payments and the ledger must be kept for legal and accounting retention, so they
        // keep pointing at a tombstone row stripped of all personal data.
        await c.query(`DELETE FROM devices WHERE user_id = $1`, [id]);
        await c.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [id]);
        await c.query(`DELETE FROM oauth_identities WHERE user_id = $1`, [id]);
        await c.query(`DELETE FROM saved_locations WHERE user_id = $1`, [id]);
        await c.query(`DELETE FROM payment_methods WHERE user_id = $1`, [id]);
        await c.query(`DELETE FROM notifications WHERE user_id = $1`, [id]);
        await c.query(`UPDATE seller_profiles SET display_name = 'Deleted seller', bio = NULL, location = NULL, kyc_provider_ref = NULL WHERE user_id = $1`, [id]);
        await c.query(`UPDATE payments SET payer_msisdn_enc = NULL WHERE payer_id = $1`, [id]);
        await c.query(
          `UPDATE users SET email = 'deleted+' || id || '@invalid.agriprice', phone = NULL, full_name = NULL, avatar_url = NULL, password_hash = NULL,
             totp_secret_enc = NULL, totp_pending_enc = NULL, email_verified_at = NULL, phone_verified_at = NULL, deletion_scheduled_at = NULL,
             suspended_at = now(), suspended_reason = 'deleted' WHERE id = $1`, [id]);
      } else {
        // Everything else cascades (devices, tokens, prefs, locations, consents, alerts, notifications).
        await c.query(`DELETE FROM users WHERE id = $1`, [id]);
      }
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

/** Daily snapshot of listed supply per commodity and region (quantity is state, not an event). */
export async function snapshotSupply(db: Pool, log: Logger): Promise<number> {
  const r = await db.query(
    `INSERT INTO supply_snapshots (at, country_iso2, commodity_id, region_id, listings, sellers, quantity_kg)
     SELECT date_trunc('day', now()), l.country_iso2, l.commodity_id, region_ancestor_at_level(l.region_id, 1), count(*)::int, count(DISTINCT l.seller_id)::int,
            round(sum(l.quantity * coalesce(
              (SELECT kg_factor FROM commodity_unit_conversions c WHERE c.commodity_id = l.commodity_id AND c.unit_code = l.unit_code AND (c.country_iso2 = l.country_iso2 OR c.country_iso2 IS NULL) ORDER BY c.country_iso2 NULLS LAST LIMIT 1),
              (SELECT kg_factor FROM units u WHERE u.code = l.unit_code))), 3)
     FROM listings l WHERE l.status IN ('active','low_stock') AND l.type = 'product' AND l.commodity_id IS NOT NULL
     GROUP BY 2, 3, 4 HAVING sum(l.quantity) > 0
     ON CONFLICT DO NOTHING`);
  log.info({ rows: r.rowCount }, "supply snapshot written");
  return r.rowCount ?? 0;
}
