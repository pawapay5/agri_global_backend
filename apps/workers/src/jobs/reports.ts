import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Queue } from "bullmq";
import ExcelJS from "exceljs";
import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { Logger } from "pino";

export interface Table { title: string; columns: string[]; rows: (string | number | null)[][] }

interface Params {
  type: "crop_price" | "market_analysis" | "forecast" | "regional" | "custom" | "seller_performance"; sellerId?: string; format: "pdf" | "xlsx" | "csv"; country: string;
  commodityIds?: string[]; marketIds?: string[]; regionIds?: string[]; from: string; to: string; priceType?: string; sections?: string[]; locale?: string;
}

const SECTIONS: Record<Params["type"], string[]> = {
  crop_price: ["summary", "history"], market_analysis: ["summary", "comparison", "history"], forecast: ["summary", "forecast", "explanations"],
  regional: ["summary", "regional"], custom: [], seller_performance: ["seller_kpis", "seller_daily", "seller_products"],
};

const pick = (t: Record<string, string> | null, l = "en") => (t ? t[l] ?? t[l.split("-")[0]!] ?? t.en ?? Object.values(t)[0] ?? "" : "");

// ── renderers (pure, unit-tested) ──
const csvCell = (v: string | number | null) => {
  if (v == null) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`; // spreadsheet formula injection guard
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(tables: Table[]): Buffer {
  const parts = tables.map((t) => [`# ${t.title}`, t.columns.map(csvCell).join(","), ...t.rows.map((r) => r.map(csvCell).join(","))].join("\n"));
  return Buffer.from("﻿" + parts.join("\n\n") + "\n", "utf8");
}

export async function toXlsx(title: string, tables: Table[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "AgriPrice"; wb.created = new Date();
  for (const t of tables) {
    const ws = wb.addWorksheet(t.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
    ws.addRow([title]).font = { bold: true, size: 13 };
    ws.addRow([]);
    const head = ws.addRow(t.columns); head.font = { bold: true };
    for (const r of t.rows) ws.addRow(r.map((v) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v)));
    ws.columns.forEach((c) => { c.width = 18; });
    ws.views = [{ state: "frozen", ySplit: 3 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function toHtml(title: string, tables: Table[], generatedAt: Date, notes: string[] = []): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font-family:Helvetica,Arial,sans-serif;color:#1d2b22;margin:32px;font-size:11px}
    h1{font-size:20px;margin:0 0 4px;color:#1f6f3b} .meta{color:#666;margin-bottom:20px}
    h2{font-size:14px;margin:22px 0 8px;border-bottom:2px solid #1f6f3b;padding-bottom:3px}
    table{border-collapse:collapse;width:100%;page-break-inside:auto} tr{page-break-inside:avoid}
    th{background:#eef5f0;text-align:left;padding:4px 6px;border:1px solid #d5e2d8} td{padding:3px 6px;border:1px solid #e3e9e4}
    td.n{text-align:right;font-variant-numeric:tabular-nums} .notes{margin-top:24px;color:#555;font-size:10px}
  </style></head><body><h1>${esc(title)}</h1><div class="meta">AgriPrice · Data. Forecasts. Better Decisions. · Generated ${esc(generatedAt.toISOString().slice(0, 16).replace("T", " "))} UTC</div>
  ${tables.map((t) => `<h2>${esc(t.title)}</h2><table><thead><tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${
    t.rows.map((r) => `<tr>${r.map((v) => `<td${typeof v === "number" || /^-?\d+(\.\d+)?%?$/.test(String(v ?? "")) ? ' class="n"' : ""}>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`).join("")}
  <div class="notes">${notes.map((n) => `<p>${esc(n)}</p>`).join("")}</div></body></html>`;
}

/** HTML → PDF through a Gotenberg container (headless Chromium), so no browser lives in the worker image. */
async function htmlToPdf(html: string): Promise<Buffer> {
  const url = process.env.GOTENBERG_URL ?? "http://localhost:3002";
  const form = new FormData();
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  form.append("paperWidth", "8.27"); form.append("paperHeight", "11.7"); form.append("printBackground", "true");
  const res = await fetch(`${url}/forms/chromium/convert/html`, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`gotenberg ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── data assembly ──
export class ReportGenerator {
  private s3 = new S3Client({
    region: process.env.S3_REGION ?? "us-east-1", endpoint: process.env.S3_ENDPOINT || undefined, forcePathStyle: Boolean(process.env.S3_ENDPOINT),
    credentials: process.env.S3_ACCESS_KEY ? { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY! } : undefined,
  });
  constructor(private db: Pool, private notifications: Queue, private log: Logger) {}

  private async q<T extends object>(sql: string, args: unknown[]) { return (await this.db.query<T & Record<string, unknown>>(sql, args)).rows; }

  async generate(reportId: string) {
    const job = (await this.q<{ id: string; user_id: string; type: Params["type"]; format: Params["format"]; params: Params; status: string }>(`SELECT * FROM report_jobs WHERE id = $1`, [reportId]))[0];
    if (!job || job.status === "succeeded") return;
    await this.db.query(`UPDATE report_jobs SET status = 'running', started_at = now(), error = NULL WHERE id = $1`, [reportId]);
    try {
      const p = job.params;
      const locale = p.locale ?? "en";
      const country = (await this.q<{ currency: string; name: Record<string, string> }>(`SELECT currency, name FROM countries WHERE iso2 = $1`, [p.country]))[0]!;
      if (job.type === "seller_performance" && p.sellerId !== job.user_id) throw new Error("seller report scope mismatch");
      const commodityIds = p.commodityIds?.length ? p.commodityIds
        : (await this.q<{ commodity_id: string }>(`SELECT DISTINCT commodity_id FROM price_daily WHERE market_id = ANY($1::uuid[]) LIMIT 20`, [p.marketIds ?? []])).map((r) => r.commodity_id);
      const names = new Map((await this.q<{ id: string; name: Record<string, string> }>(`SELECT id, name FROM commodities WHERE id = ANY($1::uuid[])`, [commodityIds])).map((r) => [r.id, pick(r.name, locale)]));
      const markets = new Map((await this.q<{ id: string; name: Record<string, string> }>(`SELECT id, name FROM markets WHERE country_iso2 = $1`, [p.country])).map((r) => [r.id, pick(r.name, locale)]));
      const pt = p.priceType ?? "wholesale";
      const sections = job.type === "custom" ? (p.sections?.length ? p.sections : ["summary", "history"]) : SECTIONS[job.type];
      const cur = country.currency;
      const tables: Table[] = [];
      const args = [commodityIds, p.country, pt, p.from, p.to, p.marketIds?.length ? p.marketIds : null];
      const scope = `commodity_id = ANY($1::uuid[]) AND country_iso2 = $2 AND price_type = $3 AND bucket BETWEEN $4::date AND $5::date AND ($6::uuid[] IS NULL OR market_id = ANY($6))`;

      if (sections.includes("summary")) {
        const rows = await this.q<{ commodity_id: string; avg: string; min: string; max: string; first: string; last: string; n: number; markets: number }>(
          `SELECT commodity_id, round(sum(sum_kg_local) / sum(n), 2)::text AS avg, round(min(min_kg_local), 2)::text AS min, round(max(max_kg_local), 2)::text AS max,
                  round((array_agg(avg_kg_local ORDER BY bucket))[1], 2)::text AS first, round((array_agg(avg_kg_local ORDER BY bucket DESC))[1], 2)::text AS last,
                  sum(n)::int AS n, count(DISTINCT market_id)::int AS markets
           FROM price_daily WHERE ${scope} GROUP BY commodity_id`, args);
        tables.push({ title: "Summary", columns: ["Commodity", `Average (${cur}/kg)`, "Low", "High", "First", "Latest", "Change %", "Observations", "Markets"],
          rows: rows.map((r) => [names.get(r.commodity_id) ?? r.commodity_id, r.avg, r.min, r.max, r.first, r.last,
            Number(r.first) > 0 ? `${(((Number(r.last) - Number(r.first)) / Number(r.first)) * 100).toFixed(1)}%` : null, r.n, r.markets]) });
      }
      if (sections.includes("history")) {
        const rows = await this.q<{ commodity_id: string; week: Date; avg: string; usd: string; n: number }>(
          `SELECT commodity_id, time_bucket('7 days', bucket) AS week, round(sum(sum_kg_local) / sum(n), 2)::text AS avg, round(sum(sum_kg_usd) / sum(n), 4)::text AS usd, sum(n)::int AS n
           FROM price_daily WHERE ${scope} GROUP BY 1, 2 ORDER BY 1, 2`, args);
        tables.push({ title: "Weekly price history", columns: ["Commodity", "Week", `Avg ${cur}/kg`, "Avg USD/kg", "Observations"],
          rows: rows.map((r) => [names.get(r.commodity_id) ?? "", r.week.toISOString().slice(0, 10), r.avg, r.usd, r.n]) });
      }
      if (sections.includes("comparison")) {
        const rows = await this.q<{ commodity_id: string; market_id: string; avg: string; last: string; n: number }>(
          `SELECT commodity_id, market_id, round(sum(sum_kg_local) / sum(n), 2)::text AS avg, round((array_agg(avg_kg_local ORDER BY bucket DESC))[1], 2)::text AS last, sum(n)::int AS n
           FROM price_daily WHERE ${scope} GROUP BY 1, 2 ORDER BY 1, 3`, args);
        tables.push({ title: "Market comparison", columns: ["Commodity", "Market", `Average ${cur}/kg`, "Latest", "Observations"],
          rows: rows.map((r) => [names.get(r.commodity_id) ?? "", markets.get(r.market_id) ?? "", r.avg, r.last, r.n]) });
      }
      if (sections.includes("regional")) {
        const rows = await this.q<{ commodity_id: string; region: Record<string, string>; avg: string; markets: number }>(
          `SELECT d.commodity_id, r.name AS region, round(sum(d.sum_kg_local) / sum(d.n), 2)::text AS avg, count(DISTINCT d.market_id)::int AS markets
           FROM price_daily d JOIN regions r ON r.id = region_ancestor_at_level(d.region_id, 1)
           WHERE d.commodity_id = ANY($1::uuid[]) AND d.country_iso2 = $2 AND d.price_type = $3 AND d.bucket BETWEEN $4::date AND $5::date
             AND ($6::uuid[] IS NULL OR r.id = ANY($6)) GROUP BY 1, 2 ORDER BY 1, 3`, [commodityIds, p.country, pt, p.from, p.to, p.regionIds?.length ? p.regionIds : null]);
        tables.push({ title: "Regional averages", columns: ["Commodity", "Region", `Average ${cur}/kg`, "Markets"], rows: rows.map((r) => [names.get(r.commodity_id) ?? "", pick(r.region, locale), r.avg, r.markets]) });
      }
      if (sections.includes("seasonal")) {
        const rows = await this.q<{ commodity_id: string; m: number; avg: string }>(
          `SELECT commodity_id, extract(month FROM bucket)::int AS m, round(sum(sum_kg_local) / sum(n), 2)::text AS avg FROM price_weekly
           WHERE commodity_id = ANY($1::uuid[]) AND country_iso2 = $2 AND price_type = $3 AND bucket >= now() - interval '3 years' GROUP BY 1, 2 ORDER BY 1, 2`, [commodityIds, p.country, pt]);
        tables.push({ title: "Seasonality (3-year monthly average)", columns: ["Commodity", "Month", `Average ${cur}/kg`], rows: rows.map((r) => [names.get(r.commodity_id) ?? "", r.m, r.avg]) });
      }
      if (sections.includes("forecast") || sections.includes("explanations")) {
        const rows = await this.q<{ id: string; commodity_id: string; market_id: string | null; region_id: string | null; horizon_months: number; target_date: Date; p10: string; p50: string; p90: string; backtest_mape: number | null; confidence: string; version: string; features: { feature: string; sharePct: number; direction: string }[] | null }>(
          `SELECT f.id, f.commodity_id, f.market_id, f.region_id, p.horizon_months, p.target_date, round(p.p10, 2)::text AS p10, round(p.p50, 2)::text AS p50, round(p.p90, 2)::text AS p90,
                  p.backtest_mape, p.confidence, mv.version, e.features
           FROM forecast_runs f JOIN forecast_points p ON p.forecast_id = f.id JOIN model_versions mv ON mv.id = f.model_version_id
           LEFT JOIN forecast_explanations e ON e.forecast_id = f.id AND e.horizon_months = p.horizon_months
           WHERE f.is_latest AND f.commodity_id = ANY($1::uuid[]) AND f.country_iso2 = $2 AND f.price_type = $3 AND ($4::uuid[] IS NULL OR f.market_id = ANY($4))
           ORDER BY f.commodity_id, f.market_id NULLS LAST, p.horizon_months`, [commodityIds, p.country, pt, p.marketIds?.length ? p.marketIds : null]);
        tables.push({ title: "Forecasts", columns: ["Commodity", "Series", "Horizon (months)", "Target", `P10 ${cur}/kg`, "P50", "P90", "Backtest MAPE %", "Confidence", "Model"],
          rows: rows.map((r) => [names.get(r.commodity_id) ?? "", r.market_id ? markets.get(r.market_id) ?? "" : "Region", r.horizon_months, r.target_date.toISOString().slice(0, 10),
            r.p10, r.p50, r.p90, r.backtest_mape != null ? r.backtest_mape.toFixed(1) : "n/a", r.confidence, r.version]) });
        if (sections.includes("explanations")) {
          tables.push({ title: "Forecast drivers (SHAP, top 3)", columns: ["Commodity", "Series", "Horizon", "Driver", "Share %", "Direction"],
            rows: rows.flatMap((r) => (r.features ?? []).slice(0, 3).map((f) => [names.get(r.commodity_id) ?? "", r.market_id ? markets.get(r.market_id) ?? "" : "Region", r.horizon_months, f.feature, f.sharePct, f.direction])) });
        }
      }

      if (sections.includes("seller_kpis")) {
        const k = (await this.q<{ revenue: string; placed: number; completed: number; cancelled: number; views: number; kg: string }>(
          `SELECT round(coalesce(sum(revenue), 0), 2)::text AS revenue, coalesce(sum(orders_placed), 0)::int AS placed, coalesce(sum(orders_completed), 0)::int AS completed,
                  coalesce(sum(orders_cancelled), 0)::int AS cancelled, coalesce(sum(views), 0)::int AS views, round(coalesce(sum(kg_sold), 0), 1)::text AS kg
           FROM seller_daily WHERE seller_id = $1 AND bucket BETWEEN $2::date AND $3::date`, [job.user_id, p.from, p.to]))[0]!;
        const buyers = (await this.q<{ n: number }>(`SELECT count(DISTINCT buyer_id)::int AS n FROM marketplace_events WHERE seller_id = $1 AND kind = 'order_placed' AND at BETWEEN $2::date AND $3::date + 1`, [job.user_id, p.from, p.to]))[0]!.n;
        tables.push({ title: "Seller performance", columns: ["Metric", "Value"], rows: [
          [`Revenue (${cur})`, k.revenue], ["Orders placed", k.placed], ["Orders completed", k.completed], ["Orders cancelled/refunded", k.cancelled],
          ["Active buyers", buyers], ["Listing views", k.views], ["Kg sold", k.kg], ["Conversion (orders/views)", k.views ? `${((k.placed / k.views) * 100).toFixed(1)}%` : "n/a"]] });
      }
      if (sections.includes("seller_daily")) {
        const rows = await this.q<{ d: Date; revenue: string; placed: number; completed: number; views: number }>(
          `SELECT bucket AS d, round(sum(revenue), 2)::text AS revenue, sum(orders_placed)::int AS placed, sum(orders_completed)::int AS completed, sum(views)::int AS views
           FROM seller_daily WHERE seller_id = $1 AND bucket BETWEEN $2::date AND $3::date GROUP BY 1 ORDER BY 1`, [job.user_id, p.from, p.to]);
        tables.push({ title: "Daily activity", columns: ["Date", `Revenue (${cur})`, "Orders placed", "Orders completed", "Views"],
          rows: rows.map((r) => [r.d.toISOString().slice(0, 10), r.revenue, r.placed, r.completed, r.views]) });
      }
      if (sections.includes("seller_products")) {
        const rows = await this.q<{ title: string; revenue: string; kg: string; orders: number; views: number }>(
          `SELECT l.title, round(sum(d.revenue), 2)::text AS revenue, round(sum(d.kg_sold), 1)::text AS kg, sum(d.orders)::int AS orders, sum(d.views)::int AS views
           FROM listing_daily d JOIN listings l ON l.id = d.listing_id WHERE d.seller_id = $1 AND d.bucket BETWEEN $2::date AND $3::date
           GROUP BY l.title ORDER BY sum(d.revenue) DESC LIMIT 50`, [job.user_id, p.from, p.to]);
        tables.push({ title: "Top products", columns: ["Listing", `Revenue (${cur})`, "Kg sold", "Orders", "Views"], rows: rows.map((r) => [r.title, r.revenue, r.kg, r.orders, r.views]) });
      }

      const title = `${{ crop_price: "Crop price report", market_analysis: "Market analysis", forecast: "Forecast report", regional: "Regional report", custom: "Custom report", seller_performance: "Seller performance" }[job.type]} · ${pick(country.name, locale)} · ${p.from} to ${p.to}`;
      const notes = ["Prices are per kg in local currency, from approved observations (crowd reports are reviewed before inclusion).",
        "Forecast intervals (P10–P90) and MAPE come from walk-forward backtests of each series.", "Sources include WFP VAM (CC BY-IGO) where indicated in the platform."];
      const body = job.format === "csv" ? toCsv(tables) : job.format === "xlsx" ? await toXlsx(title, tables) : await htmlToPdf(toHtml(title, tables, new Date(), notes));
      const key = `reports/${job.user_id}/${job.id}.${job.format}`;
      const ct = { csv: "text/csv; charset=utf-8", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pdf: "application/pdf" }[job.format];
      await this.s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET_REPORTS ?? "agriprice-reports", Key: key, Body: body, ContentType: ct }));
      const code = randomBytes(8).toString("base64url").replace(/[-_]/g, "").slice(0, 8).padEnd(8, "0");
      await this.db.query(`INSERT INTO short_links (code, target_type, target_id, created_by, expires_at) VALUES ($1,'report',$2,$3, now() + interval '90 days')`, [code, job.id, job.user_id]);
      await this.db.query(`UPDATE report_jobs SET status = 'succeeded', object_key = $2, bytes = $3, short_code = $4, finished_at = now() WHERE id = $1`, [job.id, key, body.length, code]);
      await this.notifications.add("dispatch", { userId: job.user_id, category: "system", templateKey: "report.ready", params: { title: "Your report is ready", body: title },
        data: { reportId: job.id }, channels: ["push", "in_app"], dedupeKey: `report_ready:${job.id}` }, { jobId: `dispatch_report_${job.id}` });
    } catch (e) {
      await this.db.query(`UPDATE report_jobs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [reportId, (e as Error).message.slice(0, 500)]);
      this.log.error({ err: (e as Error).message, reportId }, "report failed");
      throw e;
    }
  }
}
