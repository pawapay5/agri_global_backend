import { Injectable, Logger } from "@nestjs/common";
import { parse } from "csv-parse/sync";
import type { PoolClient } from "pg";
import type { AuthUser } from "../../common/auth/auth.common";
import { AuditService } from "../../common/audit/audit.service";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import type { ClientMeta } from "../../common/http/request-context";
import { D } from "../../common/money/money.math";
import { MoneyService } from "../../common/money/money.service";
import { QueueService } from "../../common/queue/queues";
import { decideStatus, robustZ, Source, validateObservation } from "./price.logic";

export interface RawObservation {
  commodityId: string; varietyId?: string | null; marketId: string; priceType: string; amount: string; currency: string; unit: string;
  observedAt: Date; quality?: string | null; source: Source; sourceId?: string | null; sourceRef?: string | null; submittedBy?: string | null;
  importBatchId?: string | null; lat?: number; lng?: number; note?: string | null; idempotencyKey?: string | null;
}

export interface IngestResult { id: string; status: string; flags: string[]; outlierScore: number | null; duplicate: boolean }


@Injectable()
export class PriceIngestService {
  private readonly log = new Logger(PriceIngestService.name);
  constructor(private readonly sql: Sql, private readonly money: MoneyService, private readonly queue: QueueService, private readonly audit: AuditService) {}

  async ingest(o: RawObservation, db?: PoolClient, opts: { enqueue?: boolean } = {}): Promise<IngestResult> {
    const q = <T extends object>(text: string, v: unknown[]) => (db ? db.query<T & import("pg").QueryResultRow>(text, v).then((r) => r.rows) : this.sql.many<T & import("pg").QueryResultRow>(text, v));

    const hard = validateObservation({ amount: Number(o.amount), observedAt: o.observedAt });
    if (!hard.ok) throw AppError.unprocessable(`invalid_${hard.field}`, hard.message!);

    const [market] = await q<{ country_iso2: string; region_id: string | null; currency: string }>(
      `SELECT m.country_iso2, m.region_id, c.currency FROM markets m JOIN countries c ON c.iso2 = m.country_iso2 WHERE m.id = $1 AND m.active`, [o.marketId]);
    if (!market) throw AppError.unprocessable("market_unknown", "Market not found or inactive");
    const [commodity] = await q<{ id: string }>(`SELECT id FROM commodities WHERE id = $1 AND active`, [o.commodityId]);
    if (!commodity) throw AppError.unprocessable("commodity_unknown", "Commodity not found");
    if (o.varietyId) {
      const [v] = await q(`SELECT 1 FROM varieties WHERE id = $1 AND commodity_id = $2`, [o.varietyId, o.commodityId]);
      if (!v) throw AppError.unprocessable("variety_unknown", "Variety does not belong to commodity");
    }

    // Normalise. Prices observed in a foreign currency are converted to local through USD.
    const kgPerUnit = await this.money.kgPerUnit(o.commodityId, o.unit, market.country_iso2);
    const perKgObserved = D(o.amount).div(kgPerUnit);
    const localToUsd = await this.money.rate(market.currency, "USD", o.observedAt);
    if (!localToUsd) throw AppError.unprocessable("fx_missing", `No ${market.currency}→USD rate on or before ${o.observedAt.toISOString().slice(0, 10)}`);
    let perKgLocal = perKgObserved;
    if (o.currency !== market.currency) {
      const obsToUsd = o.currency === "USD" ? { rate: "1" } : await this.money.rate(o.currency, "USD", o.observedAt);
      if (!obsToUsd) throw AppError.unprocessable("fx_missing", `No ${o.currency}→USD rate`);
      perKgLocal = perKgObserved.mul(obsToUsd.rate).div(localToUsd.rate);
    }
    const perKgUsd = perKgLocal.mul(localToUsd.rate);

    const [refRow] = await q<{ region_vals: string[] | null; country_vals: string[] | null; corroborating: number }>(
      `SELECT
         (SELECT array_agg(price_per_kg_local) FROM (SELECT price_per_kg_local FROM price_observations
            WHERE commodity_id = $1 AND price_type = $2 AND status = 'approved' AND region_id IS NOT DISTINCT FROM $3
              AND observed_at BETWEEN $5::timestamptz - interval '90 days' AND $5::timestamptz ORDER BY observed_at DESC LIMIT 200) a) AS region_vals,
         (SELECT array_agg(price_per_kg_local) FROM (SELECT price_per_kg_local FROM price_observations
            WHERE commodity_id = $1 AND price_type = $2 AND status = 'approved' AND country_iso2 = $4
              AND observed_at BETWEEN $5::timestamptz - interval '90 days' AND $5::timestamptz ORDER BY observed_at DESC LIMIT 400) b) AS country_vals,
         (SELECT count(*)::int FROM price_observations
            WHERE commodity_id = $1 AND price_type = $2 AND market_id = $6 AND status IN ('approved','pending')
              AND observed_at BETWEEN $5::timestamptz - interval '2 days' AND $5::timestamptz + interval '2 days'
              AND abs(price_per_kg_local - $7::numeric) <= 0.15 * $7::numeric
              AND submitted_by IS DISTINCT FROM $8) AS corroborating`,
      [o.commodityId, o.priceType, market.region_id, market.country_iso2, o.observedAt, o.marketId, perKgLocal.toString(), o.submittedBy ?? null]);
    const regionVals = (refRow?.region_vals ?? []).map(Number);
    const reference = regionVals.length >= 8 ? regionVals : (refRow?.country_vals ?? []).map(Number);
    const z = robustZ(perKgLocal.toNumber(), reference);

    let trust = 1;
    if (o.sourceId) trust = Number((await q<{ trust_weight: string }>(`SELECT trust_weight FROM data_sources WHERE id = $1`, [o.sourceId]))[0]?.trust_weight ?? 1);
    const decision = decideStatus(o.source, z, { corroborated: (refRow?.corroborating ?? 0) > 0, sourceTrust: trust });
    const zStored = z === null ? null : Number.isFinite(z) ? Math.round(z * 1000) / 1000 : Math.sign(z) * 99;

    const inserted = await q<{ id: string; status: string; flags: string[]; outlier_score: number | null; inserted: boolean }>(
      `INSERT INTO price_observations (
         observed_at, commodity_id, variety_id, market_id, country_iso2, region_id, price_type, amount, currency, unit_code, kg_per_unit,
         price_per_kg_local, price_per_kg_usd, fx_rate_id, quality, source, source_id, source_ref, submitted_by, import_batch_id,
         status, outlier_score, flags, location, note, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
               CASE WHEN $24::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($25, $24), 4326)::geography END, $26, $27)
       ON CONFLICT DO NOTHING
       RETURNING id, status, flags, outlier_score, true AS inserted`,
      [o.observedAt, o.commodityId, o.varietyId ?? null, o.marketId, market.country_iso2, market.region_id, o.priceType, o.amount, o.currency, o.unit,
        kgPerUnit, perKgLocal.toDecimalPlaces(6).toString(), perKgUsd.toDecimalPlaces(6).toString(), localToUsd.id, o.quality ?? null, o.source,
        o.sourceId ?? null, o.sourceRef ?? null, o.submittedBy ?? null, o.importBatchId ?? null, decision.status, zStored, decision.flags,
        o.lat ?? null, o.lng ?? null, o.note ?? null, o.idempotencyKey ?? null]);

    if (!inserted.length) {
      // Idempotent replay (same source_ref or Idempotency-Key): return the original row.
      const [existing] = await q<{ id: string; status: string; flags: string[]; outlier_score: number | null }>(
        `SELECT id, status, flags, outlier_score FROM price_observations
         WHERE observed_at = $1 AND ((source_id = $2 AND source_ref = $3) OR (submitted_by = $4 AND idempotency_key = $5)) LIMIT 1`,
        [o.observedAt, o.sourceId ?? null, o.sourceRef ?? null, o.submittedBy ?? null, o.idempotencyKey ?? null]);
      if (!existing) throw AppError.conflict("duplicate_observation");
      return { id: existing.id, status: existing.status, flags: existing.flags, outlierScore: existing.outlier_score, duplicate: true };
    }
    const row = inserted[0]!;
    if (row.status === "approved" && opts.enqueue !== false) await this.onApproved(o.commodityId, o.marketId, o.priceType, o.observedAt);
    return { id: row.id, status: row.status, flags: row.flags, outlierScore: row.outlier_score, duplicate: false };
  }

  /** Alerts are evaluated against the refreshed daily aggregate for that bucket. */
  async onApproved(commodityId: string, marketId: string, priceType: string, observedAt: Date) {
    const bucket = observedAt.toISOString().slice(0, 10);
    await this.queue.evaluateSeries({ commodityId, marketId, priceType, bucket }).catch((err) => this.log.error({ err }, "enqueue evaluate failed"));
  }

  // ── CSV import ──
  static readonly CSV_COLUMNS = ["observed_at", "market_code", "commodity_code", "price_type", "amount", "currency", "unit"] as const;

  async importCsv(file: Buffer, filename: string, country: string, sourceId: string | undefined, dryRun: boolean, user: AuthUser, client: ClientMeta) {
    if (user.role === "org_admin" || user.role === "enumerator") {
      if (user.country !== country) throw AppError.forbidden("country_scope", "You can only import prices for your own country");
    }
    let rows: Record<string, string>[];
    try {
      rows = parse(file, { columns: (h: string[]) => h.map((c) => c.trim().toLowerCase()), skip_empty_lines: true, trim: true, bom: true, relax_column_count: false });
    } catch (e) {
      throw AppError.unprocessable("csv_invalid", (e as Error).message);
    }
    if (rows.length > 50_000) throw AppError.unprocessable("csv_too_large", "Split files larger than 50,000 rows");
    const missing = PriceIngestService.CSV_COLUMNS.filter((c) => rows.length && !(c in rows[0]!));
    if (missing.length) throw AppError.unprocessable("csv_columns_missing", `Missing columns: ${missing.join(", ")}`);

    const markets = new Map((await this.sql.many<{ code: string; id: string }>(`SELECT code, id FROM markets WHERE country_iso2 = $1`, [country])).map((r) => [r.code, r.id]));
    const commodities = new Map((await this.sql.many<{ code: string; id: string }>(`SELECT code, id FROM commodities`)).map((r) => [r.code, r.id]));
    const varieties = new Map((await this.sql.many<{ k: string; id: string }>(`SELECT commodity_id || ':' || code AS k, id FROM varieties`)).map((r) => [r.k, r.id]));

    const batch = await this.sql.one<{ id: string }>(
      `INSERT INTO price_import_batches (country_iso2, source_id, uploaded_by, filename, dry_run, total_rows) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [country, sourceId ?? null, user.id, filename.slice(0, 255), dryRun, rows.length]);
    const errors: { row: number; field?: string; message: string }[] = [];
    let accepted = 0, flagged = 0, rejected = 0;
    const source: Source = user.role === "enumerator" ? "enumerator" : "admin_csv";

    for (const [i, r] of rows.entries()) {
      const rowNo = i + 2; // header is line 1
      const marketId = markets.get(r.market_code!); const commodityId = commodities.get(r.commodity_code!);
      const observedAt = new Date(r.observed_at!);
      const fail = (field: string, message: string) => { rejected++; if (errors.length < 500) errors.push({ row: rowNo, field, message }); };
      if (!marketId) { fail("market_code", `Unknown market '${r.market_code}'`); continue; }
      if (!commodityId) { fail("commodity_code", `Unknown commodity '${r.commodity_code}'`); continue; }
      if (Number.isNaN(observedAt.getTime())) { fail("observed_at", "Invalid date"); continue; }
      if (!["retail", "wholesale", "farm_gate"].includes(r.price_type!)) { fail("price_type", "Must be retail, wholesale or farm_gate"); continue; }
      if (!/^\d+(\.\d+)?$/.test(r.amount ?? "")) { fail("amount", "Must be a positive decimal"); continue; }
      const varietyId = r.variety_code ? varieties.get(`${commodityId}:${r.variety_code}`) : undefined;
      if (r.variety_code && !varietyId) { fail("variety_code", `Unknown variety '${r.variety_code}'`); continue; }

      try {
        const obs: RawObservation = {
          commodityId, marketId, varietyId, priceType: r.price_type!, amount: r.amount!, currency: r.currency!.toUpperCase(), unit: r.unit!,
          observedAt, quality: r.quality || null, source, sourceId: sourceId ?? null, sourceRef: r.source_ref || `${batch!.id}:${rowNo}`,
          submittedBy: user.id, importBatchId: batch!.id,
        };
        if (dryRun) {
          await this.sql.tx(async (c) => { await this.ingest(obs, c, { enqueue: false }); throw new DryRunRollback(); }).catch((e) => { if (!(e instanceof DryRunRollback)) throw e; });
          accepted++;
        } else {
          const res = await this.ingest(obs);
          if (res.status === "flagged" || res.status === "pending") flagged++; else accepted++;
        }
      } catch (e) {
        fail("row", e instanceof AppError ? e.detail ?? e.code : "Unexpected error");
        if (!(e instanceof AppError)) this.log.error({ err: e, row: rowNo }, "csv row failed");
      }
    }

    await this.sql.exec(`UPDATE price_import_batches SET accepted = $2, flagged = $3, rejected = $4, errors = $5 WHERE id = $1`,
      [batch!.id, accepted, flagged, rejected, JSON.stringify(errors)]);
    if (!dryRun && accepted + flagged > 0) {
      const dates = rows.map((r) => new Date(r.observed_at!)).filter((d) => !Number.isNaN(d.getTime()));
      const from = new Date(Math.min(...dates.map(Number))), to = new Date(Math.max(...dates.map(Number)) + 86_400_000);
      // Backfills older than the CAGG refresh window need an explicit refresh.
      await this.queue.refreshAggregates({ from: from.toISOString(), to: to.toISOString() });
    }
    await this.audit.record({ actorId: user.id, action: "price.import", entity: "price_import_batch", entityId: batch!.id, data: { total: rows.length, accepted, flagged, rejected, dryRun } }, client);
    return { batchId: batch!.id, dryRun, totalRows: rows.length, accepted, flagged, rejected, errors };
  }
}

class DryRunRollback extends Error {}
