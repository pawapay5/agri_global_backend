// Pure mapping for wfp-to-import-csv.mjs. Mirrors transform() in pipelines/flows/wfp_prices.py (keep in step):
// WFP rows are mapped through the country pack's aliases and the source's unit/price-type maps; anything that
// doesn't map is counted and skipped, never guessed.

export const OUT_COLUMNS = ["observed_at", "market_code", "commodity_code", "price_type", "amount", "currency", "unit", "source_ref"];
export const norm = (s) => String(s ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");

/** Name → code lookups from the pack (markets: aliases + English name + code; commodities: aliases + English name). */
export function buildLookups(markets, commodities) {
  const m = new Map(), c = new Map();
  for (const x of markets) for (const a of [...(x.aliases ?? []), x.name?.en, x.code]) if (a) m.set(norm(a), x.code);
  for (const x of commodities) for (const a of [...(x.aliases ?? []), x.name?.en]) if (a) c.set(norm(a), x.code);
  return { markets: m, commodities: c };
}

export function transform(rows, { markets, commodities }, unitMap, priceTypeMap, since) {
  const out = [], skipped = {};
  const skip = (k) => { skipped[k] = (skipped[k] ?? 0) + 1; };
  for (const r of rows) {
    if (String(r.date ?? "").startsWith("#")) continue; // HXL hashtag row
    if (since && r.date < since) { skip("before_since"); continue; }
    if (!["actual", "aggregate"].includes(String(r.priceflag || "actual").toLowerCase())) { skip("not_actual"); continue; }
    const m = markets.get(norm(r.market)), c = commodities.get(norm(r.commodity));
    const u = unitMap[String(r.unit ?? "").trim()], pt = priceTypeMap[String(r.pricetype ?? "").trim()];
    if (!m) { skip("unmapped_market"); continue; }
    if (!c) { skip("unmapped_commodity"); continue; }
    if (!u) { skip("unmapped_unit"); continue; }
    if (!pt) { skip("unmapped_price_type"); continue; }
    const price = Number(r.price);
    if (!Number.isFinite(price) || price <= 0 || String(r.price ?? "").trim() === "") { skip("bad_price"); continue; }
    out.push({
      observed_at: `${r.date}T12:00:00Z`, market_code: m, commodity_code: c, price_type: pt, amount: price.toFixed(4),
      currency: String(r.currency ?? "").trim().toUpperCase(), unit: u,
      source_ref: `wfp:${r.date}:${norm(r.market)}:${norm(r.commodity)}:${String(r.unit).trim()}:${pt}`,
    });
  }
  return { rows: out, skipped };
}

/** RFC 4180 CSV writer (values here are codes, dates and numbers, but quote defensively anyway). */
export function toCsv(rows) {
  const cell = (v) => { const s = String(v ?? ""); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [OUT_COLUMNS.join(","), ...rows.map((r) => OUT_COLUMNS.map((k) => cell(r[k])).join(","))].join("\r\n") + "\r\n";
}
