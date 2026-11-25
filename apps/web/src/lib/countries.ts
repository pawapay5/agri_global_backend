import "server-only";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const PACKS = join(process.cwd(), "..", "..", "country-packs");

export interface PackCountry { iso2: string; name: Record<string, string>; brand: string | null; currency: string; active: boolean; commodityCodes: string[]; markets: { code: string; name: Record<string, string> }[] }
export interface PackCommodity { code: string; name: Record<string, string>; category: string; hsCode: string | null }

let cache: PackCountry[] | null = null;
export function packCountries(): PackCountry[] {
  if (cache) return cache;
  const out: PackCountry[] = [];
  for (const dir of readdirSync(PACKS, { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name.startsWith("_")) continue;
    try {
      const c = parse(readFileSync(join(PACKS, dir.name, "country.yaml"), "utf8")) as { iso2: string; name: Record<string, string>; brand_name?: string; currency: string; active: boolean };
      const tracked = (parse(readFileSync(join(PACKS, dir.name, "commodities.yaml"), "utf8")) as { tracked: { code: string }[] }).tracked;
      const markets = parse(readFileSync(join(PACKS, dir.name, "markets.yaml"), "utf8")) as { code: string; name: Record<string, string> }[];
      out.push({ iso2: c.iso2, name: c.name, brand: c.brand_name ?? null, currency: c.currency, active: c.active, commodityCodes: tracked.map((t) => t.code), markets: markets.map((m) => ({ code: m.code, name: m.name })) });
    } catch { /* incomplete pack */ }
  }
  cache = out.filter((c) => c.active);
  return cache;
}

export const countrySlug = (iso2: string) => iso2.toLowerCase();
export function isLaunched(slug: string) { return packCountries().some((c) => countrySlug(c.iso2) === slug.toLowerCase()); }

let catalogue: PackCommodity[] | null = null;
/** Global commodity catalogue (names per locale, HS codes) from country-packs/_global/reference.yaml. */
export function packCatalogue(): PackCommodity[] {
  if (catalogue) return catalogue;
  const ref = parse(readFileSync(join(PACKS, "_global", "reference.yaml"), "utf8")) as { commodities: { code: string; name: Record<string, string>; category: string; hs_code?: string }[] };
  catalogue = ref.commodities.map((c) => ({ code: c.code, name: c.name, category: c.category, hsCode: c.hs_code ?? null }));
  return catalogue;
}

export function packCountry(slug: string) { return packCountries().find((c) => countrySlug(c.iso2) === slug.toLowerCase()) ?? null; }
export function packCommodity(code: string) { return packCatalogue().find((c) => c.code === code) ?? null; }

// ── Markets, regions and data sources per country (from the same pack files the backend seeds) ──
export interface PackMarket { code: string; region: string; type: string; location: [number, number]; operatingDays: number[]; name: Record<string, string> }
export interface PackRegion { code: string; iso: string; level: number; name: Record<string, string>; centroid: [number, number] }
export interface PackSource { code: string; name: string; kind: string; url?: string; licence?: string }

const packFile = <T>(iso2: string, file: string): T => parse(readFileSync(join(PACKS, iso2.toLowerCase(), file), "utf8")) as T;
const memo = new Map<string, unknown>();
function once<T>(key: string, load: () => T): T {
  if (!memo.has(key)) { try { memo.set(key, load()); } catch { memo.set(key, []); } }
  return memo.get(key) as T;
}

export function packMarkets(iso2: string): PackMarket[] {
  return once(`markets:${iso2}`, () => packFile<{ code: string; region: string; type: string; location: [number, number]; operating_days?: number[]; name: Record<string, string> }[]>(iso2, "markets.yaml")
    .map((m) => ({ code: m.code, region: m.region, type: m.type, location: m.location, operatingDays: m.operating_days ?? [], name: m.name })));
}

export function packRegions(iso2: string): PackRegion[] {
  return once(`regions:${iso2}`, () => packFile<PackRegion[]>(iso2, "regions.yaml"));
}

export function packSources(iso2: string): PackSource[] {
  return once(`sources:${iso2}`, () => packFile<{ code: string; name: string; kind: string; url?: string; licence?: string }[]>(iso2, "sources.yaml")
    .map((s) => ({ code: s.code, name: s.name, kind: s.kind, url: s.url, licence: s.licence })));
}

/** URL slug ⇄ pack code: "kumasi-central" ⇄ "kumasi_central"; regions use lower-case codes ("ah" ⇄ "AH"). */
export const marketSlug = (code: string) => code.replace(/_/g, "-");
export const regionSlug = (code: string) => code.toLowerCase();
export function packMarket(iso2: string, slug: string) { return packMarkets(iso2).find((m) => marketSlug(m.code) === slug) ?? null; }
export function packRegion(iso2: string, slug: string) { return packRegions(iso2).find((r) => regionSlug(r.code) === slug) ?? null; }
