import type { Queue } from "bullmq";
import type { Pool } from "pg";
import type { Logger } from "pino";
import { conditionMet, shouldFire } from "../alert.logic";

export interface EvaluateSeriesJob { commodityId: string; marketId: string; priceType: string; bucket: string }

interface AlertRow {
  id: string; user_id: string; commodity_id: string; market_id: string | null; region_id: string | null; country_iso2: string; condition: "above" | "below" | "pct_change";
  threshold: string; threshold_per_kg_local: string | null; threshold_currency: string | null; threshold_unit: string | null; pct_window_days: number;
  channels: string[]; cooldown_hours: number; last_state: boolean | null; last_triggered_at: Date | null;
}

/**
 * Runs for each refreshed (commodity, market, price_type, day) aggregate.
 * Idempotent: an alert can create at most one event per (alert, bucket, scope) thanks to alert_events.dedupe_key,
 * and the alert row is locked while its state is updated.
 */
export class AlertEvaluator {
  constructor(private db: Pool, private notifications: Queue, private log: Logger) {}

  /** Scope value = mean per-kg local price for the bucket day over the alert's scope (market, region subtree or country). */
  private async scopeValue(a: AlertRow, j: EvaluateSeriesJob, day: string): Promise<number | null> {
    const r = await this.db.query<{ v: string | null }>(
      `SELECT (sum(d.sum_kg_local) / nullif(sum(d.n), 0))::text AS v FROM price_daily d
       WHERE d.commodity_id = $1 AND d.price_type = $2 AND d.bucket = $3::date
         AND CASE WHEN $4::uuid IS NOT NULL THEN d.market_id = $4
                  WHEN $5::uuid IS NOT NULL THEN region_ancestor_at_level(d.region_id, (SELECT level FROM regions WHERE id = $5)) = $5
                  ELSE d.country_iso2 = $6 END`,
      [j.commodityId, j.priceType, day, a.market_id, a.region_id, a.country_iso2]);
    return r.rows[0]?.v != null ? Number(r.rows[0].v) : null;
  }

  /** Baseline for pct_change: nearest day with data at or before (bucket − window), up to 7 days earlier. */
  private async reference(a: AlertRow, j: EvaluateSeriesJob): Promise<number | null> {
    for (let back = 0; back <= 7; back++) {
      const day = new Date(Date.parse(j.bucket) - (a.pct_window_days + back) * 86_400_000).toISOString().slice(0, 10);
      const v = await this.scopeValue(a, j, day);
      if (v != null) return v;
    }
    return null;
  }

  async evaluate(j: EvaluateSeriesJob): Promise<{ evaluated: number; fired: number }> {
    const market = (await this.db.query<{ region_id: string | null; country_iso2: string; name: Record<string, string> }>(`SELECT region_id, country_iso2, name FROM markets WHERE id = $1`, [j.marketId])).rows[0];
    if (!market) return { evaluated: 0, fired: 0 };
    const alerts = (await this.db.query<AlertRow>(
      `SELECT a.* FROM alerts a JOIN users u ON u.id = a.user_id
       WHERE a.active AND u.deletion_scheduled_at IS NULL AND a.commodity_id = $1 AND a.price_type = $2
         AND (a.market_id = $3
              OR (a.market_id IS NULL AND a.region_id IS NOT NULL AND $4::uuid IS NOT NULL AND region_ancestor_at_level($4, (SELECT level FROM regions WHERE id = a.region_id)) = a.region_id)
              OR (a.market_id IS NULL AND a.region_id IS NULL AND a.country_iso2 = $5))`,
      [j.commodityId, j.priceType, j.marketId, market.region_id, market.country_iso2])).rows;

    let fired = 0;
    for (const a of alerts) {
      const value = await this.scopeValue(a, j, j.bucket);
      if (value == null) continue;
      const reference = await this.reference(a, j);
      const ev = conditionMet({ condition: a.condition, threshold: Number(a.threshold), thresholdPerKgLocal: a.threshold_per_kg_local ? Number(a.threshold_per_kg_local) : null,
        lastState: a.last_state, lastTriggeredAt: a.last_triggered_at, cooldownHours: a.cooldown_hours }, value, reference);
      if (!ev) continue;

      const client = await this.db.connect();
      try {
        await client.query("BEGIN");
        const locked = (await client.query<{ last_state: boolean | null; last_triggered_at: Date | null }>(`SELECT last_state, last_triggered_at FROM alerts WHERE id = $1 FOR UPDATE`, [a.id])).rows[0];
        if (!locked) { await client.query("ROLLBACK"); continue; }
        const decision = shouldFire({ lastState: locked.last_state, lastTriggeredAt: locked.last_triggered_at, cooldownHours: a.cooldown_hours }, ev.met);
        const scope = a.market_id ?? a.region_id ?? a.country_iso2;
        let eventId: string | undefined;
        if (decision.fire) {
          const ins = await client.query<{ id: string }>(
            `INSERT INTO alert_events (alert_id, user_id, commodity_id, market_id, condition, observed_value, threshold, change_pct, direction, dedupe_key, delivered_channels)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
            [a.id, a.user_id, a.commodity_id, a.market_id ?? j.marketId, a.condition, value, ev.compared, ev.changePct, ev.direction, `${a.id}:${j.bucket}:${scope}`, a.channels]);
          eventId = ins.rows[0]?.id;
        }
        await client.query(
          `UPDATE alerts SET last_state = $2, last_triggered_at = CASE WHEN $3 THEN now() ELSE last_triggered_at END,
             trigger_count = trigger_count + CASE WHEN $3 THEN 1 ELSE 0 END WHERE id = $1`, [a.id, ev.met, Boolean(eventId)]);
        await client.query("COMMIT");

        if (eventId) {
          fired++;
          await this.enqueueNotification(a, eventId, value, ev, market.name, j);
        }
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    }
    return { evaluated: alerts.length, fired };
  }

  private async enqueueNotification(a: AlertRow, eventId: string, valuePerKg: number, ev: { direction: string; changePct: number | null }, marketName: Record<string, string>, j: EvaluateSeriesJob) {
    const meta = (await this.db.query<{ name: Record<string, string>; locale: string; kg: string | null; usd_local: string | null; usd_thr: string | null }>(
      `SELECT c.name, coalesce(p.locale, co.default_locale) AS locale,
              coalesce((SELECT kg_factor FROM commodity_unit_conversions WHERE commodity_id = c.id AND unit_code = $3 AND (country_iso2 = $4 OR country_iso2 IS NULL) ORDER BY country_iso2 NULLS LAST LIMIT 1),
                       (SELECT kg_factor FROM units WHERE code = $3))::text AS kg,
              (SELECT rate::text FROM fx_rates WHERE base = co.currency AND quote = 'USD' ORDER BY rate_date DESC LIMIT 1) AS usd_local,
              (SELECT rate::text FROM fx_rates WHERE base = $5 AND quote = 'USD' ORDER BY rate_date DESC LIMIT 1) AS usd_thr
       FROM commodities c JOIN users u ON u.id = $2 JOIN countries co ON co.iso2 = $4 LEFT JOIN user_preferences p ON p.user_id = u.id
       WHERE c.id = $1`, [a.commodity_id, a.user_id, a.threshold_unit ?? "kg", a.country_iso2, a.threshold_currency ?? "USD"])).rows[0];
    const pick = (t: Record<string, string>, l: string) => t[l] ?? t[l.split("-")[0]!] ?? t.en ?? Object.values(t)[0] ?? "";
    const locale = meta?.locale ?? "en";
    const commodity = meta ? pick(meta.name, locale) : "";
    // Present the price in the unit/currency the user set the alert in.
    const kg = Number(meta?.kg ?? 1);
    let price = valuePerKg * kg;
    if (a.threshold_currency && meta?.usd_local && meta.usd_thr && a.threshold_currency !== "USD") price = (valuePerKg * Number(meta.usd_local) / Number(meta.usd_thr)) * kg;
    else if (a.threshold_currency === "USD" && meta?.usd_local) price = valuePerKg * Number(meta.usd_local) * kg;
    const title = a.condition === "pct_change" ? `${commodity} moved ${ev.changePct}%` : `${commodity} is ${ev.direction} your alert`;
    const body = a.condition === "pct_change"
      ? `${commodity} at ${pick(marketName, locale)} changed ${ev.changePct}% over ${a.pct_window_days} days.`
      : `${commodity} at ${pick(marketName, locale)} is now ${price.toFixed(2)} ${a.threshold_currency ?? ""}/${a.threshold_unit ?? "kg"} (your threshold: ${Number(a.threshold).toFixed(2)}).`;
    await this.notifications.add("dispatch", {
      userId: a.user_id, category: "price_alert", templateKey: "price_alert", params: { title, body },
      data: { alertId: a.id, eventId, commodityId: a.commodity_id, marketId: j.marketId, bucket: j.bucket }, channels: a.channels, dedupeKey: `alert_event:${eventId}`,
    }, { jobId: `dispatch_alert_event_${eventId}` });
  }
}

/**
 * Safety net beside the per-approval trigger: every few minutes, find series whose approved
 * observations were created since the watermark and enqueue evaluations (job ids dedupe).
 */
export async function sweepNewAggregates(db: Pool, alertsQueue: Queue, log: Logger) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const wm = (await client.query<{ processed_until: Date }>(`SELECT processed_until FROM aggregate_watermarks WHERE name = 'alerts' FOR UPDATE`)).rows[0];
    const until = new Date(Date.now() - 60_000); // let in-flight inserts settle
    const series = (await client.query<{ commodity_id: string; market_id: string; price_type: string; bucket: string }>(
      `SELECT DISTINCT commodity_id, market_id, price_type, to_char(date_trunc('day', observed_at), 'YYYY-MM-DD') AS bucket
       FROM price_observations WHERE status = 'approved' AND coalesce(reviewed_at, created_at) > $1 AND coalesce(reviewed_at, created_at) <= $2`,
      [wm?.processed_until ?? new Date(0), until])).rows;
    for (const s of series) {
      const id = `eval_${s.commodity_id}_${s.market_id}_${s.price_type}_${s.bucket}`;
      await alertsQueue.add("evaluate-series", { commodityId: s.commodity_id, marketId: s.market_id, priceType: s.price_type, bucket: s.bucket }, { jobId: id, removeOnComplete: { age: 3600 } });
    }
    await client.query(`UPDATE aggregate_watermarks SET processed_until = $1 WHERE name = 'alerts'`, [until]);
    await client.query("COMMIT");
    if (series.length) log.info({ series: series.length }, "alert sweep enqueued");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Explicit CAGG refresh for backfills (outside a transaction, as TimescaleDB requires). */
export async function refreshAggregates(db: Pool, from: string, to: string) {
  await db.query(`CALL refresh_continuous_aggregate('price_daily', $1::timestamptz, $2::timestamptz)`, [from, to]);
  const wFrom = new Date(Date.parse(from) - 7 * 86_400_000).toISOString();
  const wTo = new Date(Date.parse(to) + 7 * 86_400_000).toISOString();
  await db.query(`CALL refresh_continuous_aggregate('price_weekly', $1::timestamptz, $2::timestamptz)`, [wFrom, wTo]);
}
