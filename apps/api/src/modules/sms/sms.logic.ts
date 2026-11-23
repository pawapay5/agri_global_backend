
export type Command =
  | { cmd: "price"; commodity: string; market: string | null }
  | { cmd: "alert"; commodity: string; condition: "above" | "below"; threshold: string; market: string | null }
  | { cmd: "stop" }
  | { cmd: "help" }
  | { cmd: "unknown"; text: string };

export interface Keywords { price: string[]; alert: string[]; stop: string[]; help: string[]; above: string[]; below: string[] }
export const DEFAULT_KEYWORDS: Keywords = {
  price: ["PRICE", "PRIX", "P"], alert: ["ALERT", "ALERTE", "A"], stop: ["STOP", "UNSUBSCRIBE", "CANCEL", "ARRET"],
  help: ["HELP", "AIDE", "?"], above: ["ABOVE", "OVER", ">", "DESSUS"], below: ["BELOW", "UNDER", "<", "DESSOUS"],
};

export function mergeKeywords(extra?: Partial<Keywords>): Keywords {
  const out = { ...DEFAULT_KEYWORDS };
  for (const k of Object.keys(out) as (keyof Keywords)[]) out[k] = [...new Set([...out[k], ...(extra?.[k] ?? []).map((s) => s.toUpperCase())])];
  return out;
}

const tokens = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").split(" ").filter(Boolean);

export function parseCommand(text: string, kw: Keywords = DEFAULT_KEYWORDS): Command {
  const t = tokens(text);
  if (!t.length) return { cmd: "help" };
  const head = t[0]!.toUpperCase();
  const rest = t.slice(1);
  if (kw.stop.includes(head)) return { cmd: "stop" };
  if (kw.help.includes(head)) return { cmd: "help" };

  if (kw.price.includes(head) && rest.length) {
    // Commodity and market can both be multi-word; the resolver tries every split (longest commodity first).
    return { cmd: "price", commodity: rest.join(" "), market: null };
  }
  if (kw.alert.includes(head) && rest.length >= 3) {
    const idx = rest.findIndex((w) => kw.above.includes(w.toUpperCase()) || kw.below.includes(w.toUpperCase()));
    const amount = idx >= 0 ? rest[idx + 1]?.replace(",", ".") : undefined;
    if (idx > 0 && amount && /^\d+(\.\d{1,2})?$/.test(amount)) {
      return {
        cmd: "alert", commodity: rest.slice(0, idx).join(" "),
        condition: kw.above.includes(rest[idx]!.toUpperCase()) ? "above" : "below",
        threshold: amount, market: rest.slice(idx + 2).join(" ") || null,
      };
    }
  }
  return { cmd: "unknown", text };
}

// ── fuzzy name resolution ──
export const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!; prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

export interface NameEntry { id: string; names: string[] }

/** Exact match on any alias, then a single unambiguous typo (≤1 edit for 4–7 chars, ≤2 for longer). */
export function resolveName(input: string, entries: NameEntry[]): string | null {
  const q = norm(input);
  if (!q) return null;
  for (const e of entries) if (e.names.some((n) => norm(n) === q)) return e.id;
  // Plural/singular ("tomatoes" vs "tomato") and prefix matches
  const stem = q.replace(/(es|s)$/, "");
  for (const e of entries) if (e.names.some((n) => { const m = norm(n); return m.replace(/(es|s)$/, "") === stem || (q.length >= 4 && m.startsWith(q)); })) return e.id;
  const max = q.length >= 8 ? 2 : q.length >= 4 ? 1 : 0;
  if (!max) return null;
  const hits = entries.filter((e) => e.names.some((n) => levenshtein(norm(n), q) <= max));
  return hits.length === 1 ? hits[0]!.id : null;
}

/** "tomato kumasi central" → try commodity = longest prefix that resolves; the rest is the market. */
export function splitCommodityMarket(phrase: string, commodities: NameEntry[], markets: NameEntry[]): { commodityId: string | null; marketId: string | null; marketText: string | null } {
  const words = tokens(phrase);
  for (let i = words.length; i >= 1; i--) {
    const c = resolveName(words.slice(0, i).join(" "), commodities);
    if (c) {
      const mt = words.slice(i).join(" ");
      return { commodityId: c, marketId: mt ? resolveName(mt, markets) : null, marketText: mt || null };
    }
  }
  return { commodityId: null, marketId: null, marketText: null };
}

/** SMS replies must fit one GSM-7 segment where possible (160 chars). */
export function fitSms(text: string, max = 160): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
