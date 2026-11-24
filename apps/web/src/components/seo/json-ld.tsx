import { routing } from "@/i18n/routing";

/** Renders JSON-LD safely (escapes "<" so content can't break out of the script tag). */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

/** hreflang alternates for a locale-prefixed path ("/gh/prices/tomato"). */
export function alternates(path: string, current: string) {
  const languages = Object.fromEntries(routing.locales.map((l) => [l, `/${l}${path}`]));
  return { canonical: `/${current}${path}`, languages: { ...languages, "x-default": `/${routing.defaultLocale}${path}` } };
}

export function breadcrumbs(items: { name: string; url: string }[], base: string) {
  return {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: `${base}${it.url}` })),
  };
}
