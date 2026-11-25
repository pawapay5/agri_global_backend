import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

/**
 * Valid URL slugs per launched country, from /country-packs, for proxy.ts to answer unknown ones with a real 404.
 * (Pages can't: with Cache Components a not-found inside a streamed page keeps status 200.) Deliberately free of
 * "server-only" and of lib/countries.ts so the proxy bundle can import it.
 */
export interface SlugIndex { countries: Set<string>; crops: Map<string, Set<string>>; markets: Map<string, Set<string>>; regions: Map<string, Set<string>> }

let index: SlugIndex | null = null;

export function slugIndex(): SlugIndex {
  if (index) return index;
  const root = join(process.cwd(), "..", "..", "country-packs");
  const out: SlugIndex = { countries: new Set(), crops: new Map(), markets: new Map(), regions: new Map() };
  try {
    for (const dir of readdirSync(root, { withFileTypes: true })) {
      if (!dir.isDirectory() || dir.name.startsWith("_")) continue;
      try {
        const read = <T>(f: string) => parse(readFileSync(join(root, dir.name, f), "utf8")) as T;
        if (!read<{ active?: boolean }>("country.yaml").active) continue;
        const cc = dir.name.toLowerCase();
        out.countries.add(cc);
        out.crops.set(cc, new Set(read<{ tracked: { code: string }[] }>("commodities.yaml").tracked.map((t) => t.code.replace(/_/g, "-"))));
        out.markets.set(cc, new Set(read<{ code: string }[]>("markets.yaml").map((m) => m.code.replace(/_/g, "-"))));
        out.regions.set(cc, new Set(read<{ code: string }[]>("regions.yaml").map((r) => r.code.toLowerCase())));
      } catch { /* incomplete pack: ignored, like lib/countries */ }
    }
  } catch { /* packs missing: validate nothing rather than 404 everything */ }
  index = out;
  return index;
}

/**
 * True when a public path names a country, crop, market or region that doesn't exist.
 * Paths are locale-stripped segments, e.g. ["gh", "markets", "kumasi-central"]; ["guides", "tomato"].
 */
export function isUnknownPublicPath(seg: string[], idx: SlugIndex = slugIndex()): boolean {
  if (!idx.countries.size) return false;
  const [first, section, slug] = seg;
  if (first === "guides" && section) {
    const any = [...idx.crops.values()].some((s) => s.has(section));
    return !any;
  }
  if (!first || !["prices", "markets", "regions", "marketplace"].includes(section ?? "")) return false;
  if (!idx.countries.has(first)) return true;
  if (!slug) return false;
  const set = section === "prices" ? idx.crops.get(first) : section === "markets" ? idx.markets.get(first) : section === "regions" ? idx.regions.get(first) : null;
  return set ? !set.has(slug) : false;
}
