import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { pct } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Signed % change. Direction is carried by the arrow AND the sign AND screen-reader text, never colour alone.
 * `upIsGood=false` (e.g. for buyers watching input costs) keeps the arrow but flips which colour means good.
 */
export function ChangeBadge({ value, period, upIsGood = true, variant = "inline", className }: {
  value: number | null | undefined; period?: string; upIsGood?: boolean; variant?: "inline" | "pill"; className?: string;
}) {
  const t = useTranslations("ds");
  const locale = useLocale();
  if (value == null || !Number.isFinite(value)) return <span className={cn("text-sm text-muted-fg", className)}>—<span className="sr-only">{t("noChange")}</span></span>;
  const dir = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const Icon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;
  const good = dir === "flat" ? null : (dir === "up") === upIsGood;
  const text = pct(value, locale);
  const spoken = dir === "up" ? t("upBy", { pct: text }) : dir === "down" ? t("downBy", { pct: text.replace(/^[-−]/, "") }) : t("unchanged");
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 text-sm font-semibold tabular",
      variant === "pill"
        ? (good === null ? "rounded-full bg-muted px-2 py-0.5 text-muted-fg" : good ? "rounded-full bg-up/10 px-2 py-0.5 text-up-ink" : "rounded-full bg-down/10 px-2 py-0.5 text-down-ink")
        : good === null ? "text-muted-fg" : good ? "text-up" : "text-down",
      className,
    )}>
      <Icon aria-hidden className="size-4 rtl:-scale-x-100" />
      <span aria-hidden>{text}</span>
      <span className="sr-only">{spoken}{period ? ` ${t("vsPeriod", { period })}` : ""}</span>
      {period ? <span aria-hidden className="ms-1 font-normal text-muted-fg">{period}</span> : null}
    </span>
  );
}
