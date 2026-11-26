#!/usr/bin/env node
// Turns WFP's public food-price history (HDX) into AgriPrice import CSVs for Admin → Price import.
// Runs on any machine with this repo; no database or API access needed.
//
//   node apps/api/scripts/wfp-to-import-csv.mjs                 # download Ghana's file from HDX
//   node apps/api/scripts/wfp-to-import-csv.mjs --file wfp.csv  # or use a file you downloaded
//   options: --country gh   --since 2019-01-01   --out ./wfp-import
//
// Writes wfp-<cc>-import-1.csv, -2.csv … (≤ 45,000 rows each; the API takes 50,000 per upload) and prints what
// was skipped. Data: WFP VAM via HDX, licence CC BY-IGO (attribute WFP when you show it).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseCsv } from "csv-parse/sync";
import { parse as parseYaml } from "yaml";
import { buildLookups, toCsv, transform } from "./wfp-to-import-csv.lib.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const cc = opt("country", "gh").toLowerCase();
const since = opt("since");
const outDir = resolve(opt("out", "./wfp-import"));
const PER_FILE = 45_000;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../country-packs");
const pack = (f) => parseYaml(readFileSync(join(root, cc, f), "utf8"));
const markets = pack("markets.yaml");
const commodities = pack("commodities.yaml").tracked;
const source = pack("sources.yaml").find((s) => s.code === `wfp_hdx_${cc}`);
if (!source) throw new Error(`country-packs/${cc}/sources.yaml has no wfp_hdx_${cc} source`);

/** HDX sometimes answers with an empty or error body: retry a few times before giving up with a clear message. */
async function fetchRetry(url, as) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return as === "json" ? await r.json() : await r.text();
    } catch (e) {
      if (attempt >= 3) throw new Error(`HDX request failed after 3 tries (${e.message}). Try again later, or download the CSV yourself and pass --file.`);
      console.log(`HDX request failed (${e.message}); retrying in ${attempt * 5}s…`);
      await new Promise((res) => setTimeout(res, attempt * 5000));
    }
  }
}

async function download(packageId) {
  const meta = await fetchRetry(`https://data.humdata.org/api/3/action/package_show?id=${encodeURIComponent(packageId)}`, "json");
  const resources = meta?.result?.resources ?? [];
  const res = resources.find((x) => String(x.format).toUpperCase() === "CSV" && /food_prices/i.test(x.name ?? "")) ?? resources.find((x) => String(x.format).toUpperCase() === "CSV");
  if (!res) throw new Error(`No CSV resource found on HDX for ${packageId}`);
  console.log(`Downloading ${res.url}`);
  return fetchRetry(res.url, "text");
}

const text = opt("file") ? readFileSync(resolve(opt("file")), "utf8") : await download(source.config.hdx_package_id);
const raw = parseCsv(text, { columns: (h) => h.map((c) => c.trim().toLowerCase()), skip_empty_lines: true, bom: true, relax_column_count: true });
const { rows, skipped } = transform(raw, buildLookups(markets, commodities), source.config.unit_map ?? {}, source.config.price_type_map ?? {}, since);

mkdirSync(outDir, { recursive: true });
const files = [];
for (let i = 0; i < rows.length; i += PER_FILE) {
  const file = join(outDir, `wfp-${cc}-import-${files.length + 1}.csv`);
  writeFileSync(file, toCsv(rows.slice(i, i + PER_FILE)));
  files.push(file);
}
const dates = rows.map((r) => r.observed_at.slice(0, 10)).sort();
console.log(`\nRead ${raw.length} WFP rows; ${rows.length} mapped${dates.length ? ` (${dates[0]} → ${dates.at(-1)})` : ""}.`);
console.log("Skipped:", Object.keys(skipped).length ? skipped : "none");
console.log(files.length ? `\nWrote:\n  ${files.join("\n  ")}\n\nUpload each in Admin → Price import (country ${cc.toUpperCase()}): check first, then import.` : "\nNothing to write.");
