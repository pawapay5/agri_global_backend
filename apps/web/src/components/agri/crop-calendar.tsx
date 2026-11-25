import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const ROWS = [
  { key: "planting", cls: "bg-[var(--chart-history)]" },
  { key: "harvest", cls: "bg-[var(--chart-forecast)]" },
  { key: "lean", cls: "bg-[var(--down)]" },
] as const;

/**
 * Crop calendar for one season profile: planting, harvest and lean months on a 12-month strip. Each row is
 * labelled and also stated in text (the months listed), so nothing depends on the fill colours.
 */
export function CropCalendar({ plantingMonths: p = [], harvestMonths: h = [], leanMonths: l = [], className }: {
  plantingMonths?: number[]; harvestMonths?: number[]; leanMonths?: number[]; className?: string;
}) {
  const t = useTranslations("cmd");
  // Only calendar months 1–12 count; anything else from the API is ignored rather than drawn.
  const valid = (ms: number[]) => ms.filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
  const plantingMonths = valid(p), harvestMonths = valid(h), leanMonths = valid(l);
  const locale = useLocale();
  const m = (n: number, style: "narrow" | "long") => new Intl.DateTimeFormat(locale, { month: style, timeZone: "UTC" }).format(Date.UTC(2024, n - 1, 1));
  const months: Record<(typeof ROWS)[number]["key"], number[]> = { planting: plantingMonths, harvest: harvestMonths, lean: leanMonths };
  if (!plantingMonths.length && !harvestMonths.length && !leanMonths.length) return null;
  return (
    <div className={cn("space-y-2", className)}>
      <div className="grid grid-cols-[6rem_repeat(12,minmax(0,1fr))] gap-0.5 text-center text-[11px] text-muted-fg" aria-hidden>
        <span />{Array.from({ length: 12 }, (_, i) => <span key={i}>{m(i + 1, "narrow")}</span>)}
      </div>
      {ROWS.map((r) => months[r.key].length ? (
        <div key={r.key} className="grid grid-cols-[6rem_repeat(12,minmax(0,1fr))] items-center gap-0.5">
          <span className="truncate text-xs font-medium">{t(r.key)}</span>
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} aria-hidden className={cn("h-4 rounded-sm", months[r.key].includes(i + 1) ? r.cls : "bg-muted")} />
          ))}
          <span className="sr-only">{t(r.key)}: {months[r.key].map((n) => m(n, "long")).join(", ")}</span>
        </div>
      ) : null)}
    </div>
  );
}
