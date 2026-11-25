import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { slugOf } from "@/lib/api/public";
import { countrySlug, marketSlug, packCountries, packMarkets, packRegions, regionSlug } from "@/lib/countries";

const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/**
 * One sitemap per launched country (/sitemap/gh.xml …) plus one for country-independent pages
 * (/sitemap/site.xml), each URL with every locale as hreflang alternates. Built from the country packs, so it
 * never depends on the API. Pages whose content may not exist yet (crop guides without a guide, individual help
 * articles, pests, listings) are left out until they can be listed from the API: no thin pages in the index.
 */
export async function generateSitemaps() {
  return [...packCountries().map((c) => ({ id: countrySlug(c.iso2) })), { id: "site" }];
}

const entry = (path: string, priority: number, changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]): MetadataRoute.Sitemap[number] => ({
  url: `${base}/${routing.defaultLocale}${path}`,
  changeFrequency, priority,
  alternates: { languages: Object.fromEntries(routing.locales.map((l) => [l, `${base}/${l}${path}`])) },
});

export default async function sitemap({ id }: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const slug = await id;
  if (slug === "site") {
    return [
      entry("", 1, "daily"),
      ...["/methodology", "/about", "/pricing", "/help", "/stories", "/guides", "/pests", "/contact"].map((p) => entry(p, 0.5, "weekly")),
      ...["/legal/privacy", "/legal/terms"].map((p) => entry(p, 0.2, "yearly")),
    ];
  }
  const c = packCountries().find((x) => countrySlug(x.iso2) === slug);
  if (!c) return [];
  return [
    entry(`/${slug}/prices`, 0.9, "daily"),
    ...c.commodityCodes.map((code) => entry(`/${slug}/prices/${slugOf(code)}`, 0.8, "daily")),
    entry(`/${slug}/markets`, 0.7, "weekly"),
    ...packMarkets(c.iso2).map((m) => entry(`/${slug}/markets/${marketSlug(m.code)}`, 0.7, "daily")),
    entry(`/${slug}/regions`, 0.6, "weekly"),
    ...packRegions(c.iso2).map((r) => entry(`/${slug}/regions/${regionSlug(r.code)}`, 0.6, "daily")),
    entry(`/${slug}/marketplace`, 0.6, "daily"),
  ];
}
