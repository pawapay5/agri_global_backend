"use client";
import { Brain } from "lucide-react";
import { useTranslations } from "next-intl";
import { shapBars } from "@/lib/charts";
import { cn } from "@/lib/utils";

interface Feature { feature: string; i18nKey: string; sharePct: number; contribution: number; direction: "up" | "down" }

/** "Why this prediction?": top SHAP drivers with share of impact and direction, plus the generated insight. */
export function ShapPanel({ features, insight, featureLabel }: { features: Feature[]; insight?: string; featureLabel: (key: string, fallback: string) => string }) {
  const t = useTranslations("app");
  const bars = shapBars(features);
  return (
    <section aria-labelledby="why-title" className="space-y-4">
      <h3 id="why-title" className="text-base font-semibold">{t("why")}</h3>
      <ul className="space-y-2.5">
        {bars.map((b) => (
          <li key={b.feature} className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3 text-sm">
            <span className="truncate" title={featureLabel(b.i18nKey, b.feature)}>{featureLabel(b.i18nKey, b.feature)}</span>
            <span className="h-2.5 rounded-full bg-muted" role="presentation">
              <span className={cn("block h-full rounded-full", b.direction === "up" ? "bg-brand" : "bg-down")} style={{ width: `${b.widthPct}%` }} />
            </span>
            <span className="text-end tabular text-muted-fg">{b.sharePct.toFixed(0)}%</span>
          </li>
        ))}
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
