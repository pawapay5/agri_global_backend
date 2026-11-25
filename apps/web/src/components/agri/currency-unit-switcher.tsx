"use client";
import { useTranslations } from "next-intl";
import { parseAsString, useQueryStates } from "nuqs";
import { useEffect } from "react";
import { unitLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const PREF_CURRENCY = "ap_currency", PREF_UNIT = "ap_unit";
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string | null) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* unavailable */ } } };

/**
 * Display currency and unit. The URL is the state (?currency=&unit=) so a shared link shows the same numbers;
 * the choice is also remembered locally, and the API client sends it as X-Currency / X-Unit (lib/api/browser).
 * The API does the conversion and returns display fields; this component never converts anything.
 */
export function CurrencyUnitSwitcher({ currencies, units, onChange, className }: {
  currencies: string[]; units: string[]; onChange?: (v: { currency: string | null; unit: string | null }) => void; className?: string;
}) {
  const t = useTranslations("ds");
  const [q, setQ] = useQueryStates({ currency: parseAsString, unit: parseAsString });

  // First visit with no URL params: adopt the remembered preference.
  useEffect(() => {
    if (q.currency == null && q.unit == null) {
      const currency = store.get(PREF_CURRENCY), unit = store.get(PREF_UNIT);
      if (currency || unit) void setQ({ currency, unit });
    }
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (patch: { currency?: string | null; unit?: string | null }) => {
    const next = { currency: patch.currency !== undefined ? patch.currency : q.currency, unit: patch.unit !== undefined ? patch.unit : q.unit };
    store.set(PREF_CURRENCY, next.currency);
    store.set(PREF_UNIT, next.unit);
    void setQ(next);
    onChange?.(next);
  };

  const select = "h-9 rounded-lg border border-border bg-card px-2 text-sm";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <label className="sr-only" htmlFor="ap-currency">{t("currency")}</label>
      <select id="ap-currency" value={q.currency ?? ""} onChange={(e) => update({ currency: e.target.value || null })} className={select}>
        <option value="">{t("currency")}</option>
        {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <label className="sr-only" htmlFor="ap-unit">{t("unit")}</label>
      <select id="ap-unit" value={q.unit ?? ""} onChange={(e) => update({ unit: e.target.value || null })} className={select}>
        <option value="">{t("unit")}</option>
        {units.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
      </select>
    </div>
  );
}
