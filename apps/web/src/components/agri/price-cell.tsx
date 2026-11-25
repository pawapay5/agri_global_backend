import { useLocale } from "next-intl";
import { money, unitLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A price exactly as the API's display fields give it (amount in the caller's currency and unit), formatted
 * for the locale. Never converts or rounds for meaning. `size="lg"` uses proportional figures (headline
 * values); table cells keep tabular figures so columns align.
 */
export function PriceCell({ amount, currency, unit, size = "md", className }: {
  amount: string | number | null | undefined; currency: string; unit: string; size?: "sm" | "md" | "lg"; className?: string;
}) {
  const locale = useLocale();
  const value = money(amount, currency, locale);
  if (value === "—") return <span className={cn("text-muted-fg", className)}>—</span>;
  return (
    <span className={cn("whitespace-nowrap", size === "lg" ? "text-3xl font-semibold" : "tabular", size === "sm" && "text-sm", className)}>
      {value}
      <span className={cn("font-normal text-muted-fg", size === "lg" ? "ms-1 text-base" : "text-[0.85em]")}>/{unitLabel(unit)}</span>
    </span>
  );
}
