"use client";
import { ArrowDown, ArrowUp, Brain } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { number } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ShapFeature { feature: string; i18nKey: string; sharePct: number; contribution: number; direction: "up" | "down" }

/**
 * "Why this forecast?": diverging bars from a centre baseline. Raises (warm, --shap-up) grow right, lowers
 * (cool, --shap-down) grow left; length = share of total impact. Direction is also an arrow + text, and the
 * share is printed at each bar tip, so the list is its own table view.
 */
export function ShapBars({ features, insight, featureLabel, className }: {
  features: ShapFeature[]; insight?: string; featureLabel?: (key: string, fallback: string) => string; className?: string;
}) {
  const t = useTranslations("ds");
  const locale = useLocale();
  const label = featureLabel ?? ((_k: string, f: string) => f.replace(/_/g, " "));
  const max = Math.max(1, ...features.map((f) => f.sharePct));
  const sorted = [...features].sort((a, b) => b.sharePct - a.sharePct);
  return (
    <section className={cn("space-y-4", className)}>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-fg" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-shap-down" />{t("lowers")}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-shap-up" />{t("raises")}</span>
      </div>
      <ul className="space-y-2">
        {sorted.map((f) => {
          const name = label(f.i18nKey, f.feature);
          const w = `${(f.sharePct / max) * 50}%`;
          const up = f.direction === "up";
          const share = `${number(f.sharePct, locale, { digits: 0 })}%`;
          return (
            <li key={f.feature} tabIndex={0} aria-label={`${name}: ${up ? t("raises") : t("lowers")}, ${t("share")} ${share}`}
              className="group grid grid-cols-[minmax(0,9rem)_1fr_3rem] items-center gap-3 rounded-md text-sm focus-visible:outline-2 focus-visible:outline-[var(--ring)] sm:grid-cols-[minmax(0,12rem)_1fr_3rem]">
              <span className="truncate" title={name}>{name}</span>
              <span className="relative h-3" aria-hidden>
                <span className="absolute inset-y-[-2px] start-1/2 w-px bg-[var(--chart-grid)]" />
                <span
                  className={cn("absolute top-0 h-3 group-hover:brightness-110", up ? "start-1/2 rounded-e-[4px] bg-shap-up" : "end-1/2 rounded-s-[4px] bg-shap-down")}
                  style={{ width: w }}
                />
              </span>
              <span className="flex items-center justify-end gap-0.5 text-muted-fg tabular">
                {up ? <ArrowUp aria-hidden className="size-3.5" /> : <ArrowDown aria-hidden className="size-3.5" />}{share}
              </span>
            </li>
          );
        })}
      </ul>
      {insight ? (
        <div className="flex gap-3 rounded-xl bg-info p-3 text-sm">
          <Brain aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />
          <p>{insight}</p>
        </div>
      ) : null}
    </section>
  );
}
