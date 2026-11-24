import type { MetadataRoute } from "next";
import { countrySlug, packCountries } from "@/lib/countries";

const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/*/app/", "/*/admin/", "/*/login", "/*/signup"] }],
    sitemap: packCountries().map((c) => `${base}/sitemap/${countrySlug(c.iso2)}.xml`),
  };
}
