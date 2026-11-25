import "server-only";
import { getTranslations } from "next-intl/server";
import { packCountries } from "./countries";
import { pick } from "./utils";

/** Market trading days as weekday names in the reader's language ([1,2,3] → "Monday, Tuesday, Wednesday"). */
export function weekdays(days: number[], locale: string) {
  // 2024-01-01 was a Monday, so ISO weekday d is 2024-01-0d.
  const f = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
  return days.map((d) => f.format(Date.UTC(2024, 0, d))).join(", ");
}

/** The country used by routes that aren't country-scoped yet (guides, pests, help): the first launched pack. */
export function defaultCountry() {
  const c = packCountries()[0];
  return c ? { iso2: c.iso2, slug: c.iso2.toLowerCase(), name: c.name } : null;
}

export async function countryName(locale: string, name: Record<string, string> | undefined) {
  return pick(name, locale);
}

export async function tPub(locale: string) {
  return getTranslations({ locale, namespace: "pub" });
}
