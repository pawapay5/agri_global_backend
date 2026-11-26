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

/**
 * WFP unit string → [our unit code, divisor for the price]. Explicit unitMap entries win. Otherwise a stated weight
 * ("93 KG") becomes a per-kg price and a stated count ("100 Tubers", "30 pcs") a per-tuber/per-piece price: exact
 * conversions from what WFP states, never an assumed bag size. Same as unit_and_divisor() in wfp_prices.py.
 */
export function unitAndDivisor(raw, unitMap) {
  const s = String(raw ?? "").trim();
  if (Object.hasOwn(unitMap, s)) return [unitMap[s], 1];
  let m = /^(\d+(?:\.\d+)?)\s*kg$/i.exec(s);
  if (m && Number(m[1]) > 0) return ["kg", Number(m[1])];
  m = /^(\d+)\s*(pcs|pieces?|units?|tubers?)$/i.exec(s);
  if (m && Number(m[1]) > 0) return [/^tuber/i.test(m[2]) ? "tuber" : "piece", Number(m[1])];
  return [null, 1];
}

export function transform(rows, { markets, commodities }, unitMap, priceTypeMap, since) {
  const out = [], skipped = {};
  const skip = (k) => { skipped[k] = (skipped[k] ?? 0) + 1; };
  for (const r of rows) {
    if (String(r.date ?? "").startsWith("#")) continue; // HXL hashtag row
    if (since && r.date < since) { skip("before_since"); continue; }
    if (!["actual", "aggregate"].includes(String(r.priceflag || "actual").toLowerCase())) { skip("not_actual"); continue; }
    const m = markets.get(norm(r.market)), c = commodities.get(norm(r.commodity));
    const [u, per] = unitAndDivisor(r.unit, unitMap), pt = priceTypeMap[String(r.pricetype ?? "").trim()];
    if (!m) { skip("unmapped_market"); continue; }
    if (!c) { skip("unmapped_commodity"); continue; }
    if (!u) { skip("unmapped_unit"); continue; }
    if (!pt) { skip("unmapped_price_type"); continue; }
    const price = Number(r.price) / per;
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
