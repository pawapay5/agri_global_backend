import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { slugOf } from "@/lib/api/public";
import { countrySlug, packCountries } from "@/lib/countries";

const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** One sitemap per launched country (/sitemap/gh.xml …), each with every locale as hreflang alternates. */
export async function generateSitemaps() {
  return packCountries().map((c) => ({ id: countrySlug(c.iso2) }));
}

const entry = (path: string, priority: number, changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]): MetadataRoute.Sitemap[number] => ({
  url: `${base}/${routing.defaultLocale}${path}`,
  changeFrequency, priority,
  alternates: { languages: Object.fromEntries(routing.locales.map((l) => [l, `${base}/${l}${path}`])) },
});

export default async function sitemap({ id }: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const slug = await id;
  const c = packCountries().find((x) => countrySlug(x.iso2) === slug);
  if (!c) return [];
  return [
    entry("", 1, "daily"),
    entry(`/${slug}/prices`, 0.9, "daily"),
    ...c.commodityCodes.map((code) => entry(`/${slug}/prices/${slugOf(code)}`, 0.8, "daily")),
  ];
}
