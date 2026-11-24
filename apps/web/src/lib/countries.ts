import "server-only";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

/**
 * Build-time knowledge of launched countries, read from /country-packs (the same files the backend seeds from).
 * Used for generateStaticParams and sitemaps so prerendering never depends on the API being up.
 */
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
