
export const DASH = "—";

const toNum = (v: string | number | null | undefined) => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const cache = new Map<string, Intl.NumberFormat>();
function nf(locale: string, opts: Intl.NumberFormatOptions) {
  const key = locale + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) {
    try { f = new Intl.NumberFormat(locale, opts); } catch { f = new Intl.NumberFormat("en", opts); }
    cache.set(key, f);
  }
  return f;
}

/** Money in the API's display currency: `GHS 12.50`. Code display avoids ambiguous "$"-style symbols across countries. */
export function money(amount: string | number | null | undefined, currency: string, locale = "en", opts: { compact?: boolean } = {}) {
  const n = toNum(amount);
  if (n == null || !/^[A-Z]{3}$/.test(currency)) return DASH;
  return nf(locale, {
    style: "currency", currency, currencyDisplay: "code",
    ...(opts.compact ? { notation: "compact", maximumFractionDigits: 1 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  }).format(n).replace(/ /g, " ");
}

/** Plain number; `compact` gives 1.2K / 3.4M, as the dataviz rules ask for stat tiles and large axes. */
export function number(v: string | number | null | undefined, locale = "en", opts: { compact?: boolean; digits?: number } = {}) {
  const n = toNum(v);
  if (n == null) return DASH;
  return nf(locale, opts.compact
    ? { notation: "compact", maximumFractionDigits: 1 }
    : { maximumFractionDigits: opts.digits ?? 0, minimumFractionDigits: opts.digits ?? 0 }).format(n);
}

/** Signed percentage from a percent value (4.2 → "+4.2%"). Zero has no sign. */
export function pct(v: number | null | undefined, locale = "en", digits = 1) {
  if (v == null || !Number.isFinite(v)) return DASH;
  return nf(locale, { style: "percent", signDisplay: "exceptZero", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v / 100);
}

/** Unsigned percentage for magnitudes (a gap, a coefficient of variation, "rise 12%"): 12 → "12.0%". */
export function pctPlain(v: number | null | undefined, locale = "en", digits = 1) {
  if (v == null || !Number.isFinite(v)) return DASH;
  return nf(locale, { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(v) / 100);
}

/** Unit codes from the catalogue → short labels. Unknown codes fall back to the code with underscores spaced. */
const UNIT_LABELS: Record<string, string> = { kg: "kg", g: "g", t: "t", l: "L", ml: "mL", each: "each", dozen: "dozen", crate: "crate" };
export function unitLabel(code: string | null | undefined) {
  if (!code) return "";
  if (UNIT_LABELS[code]) return UNIT_LABELS[code]!;
  const bag = code.match(/^bag_(\d+)kg$/);
  if (bag) return `${bag[1]} kg bag`;
  return code.replace(/_/g, " ");
}

/** "GHS 12.50/kg": the price and its unit, as every price cell shows it. */
export function pricePerUnit(amount: string | number | null | undefined, currency: string, unit: string, locale = "en") {
  const m = money(amount, currency, locale);
  return m === DASH ? DASH : `${m}/${unitLabel(unit)}`;
}

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31_536_000], ["month", 2_592_000], ["week", 604_800], ["day", 86_400], ["hour", 3_600], ["minute", 60]];

/** "2 hours ago" / "in 3 days" in the user's locale. Under a minute reads "now". */
export function relativeTime(iso: string | number | Date | null | undefined, locale = "en", now: number = Date.now()) {
  if (iso == null) return DASH;
  const t = iso instanceof Date ? iso.getTime() : typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return DASH;
  const diff = Math.round((t - now) / 1000);
  let rtf: Intl.RelativeTimeFormat;
  try { rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }); } catch { rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" }); }
  for (const [unit, secs] of STEPS) {
    if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
  }
  return rtf.format(0, "second");
}

/** Absolute timestamp for tooltips and <time> titles, always UTC-labelled so it means the same everywhere. */
export function absoluteTime(iso: string | null | undefined, locale = "en") {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return DASH;
  // Explicit fields: Intl throws if dateStyle/timeStyle are combined with timeZoneName.
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(d);
}

export function shortDate(t: number | string, locale = "en", opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  const d = new Date(t);
  if (!Number.isFinite(d.getTime())) return DASH;
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...opts }).format(d);
}
