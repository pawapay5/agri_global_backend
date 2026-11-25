import { Lightbulb, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  info: "bg-info",
  positive: "bg-up/10",
  caution: "bg-forecast/10",
  neutral: "bg-muted",
} as const;

/**
 * One insight (seasonal tip, recommendation, weather impact). Text comes from the API (already localised);
 * `tone` only sets the wash and is never the sole signal: the title and icon say what it is.
 */
export function InsightCard({ title, children, icon: Icon = Lightbulb, tone = "info", meta, action, className }: {
  title: string; children: ReactNode; icon?: LucideIcon; tone?: keyof typeof TONES; meta?: ReactNode; action?: ReactNode; className?: string;
}) {
  return (
    <article className={cn("flex gap-3 rounded-2xl p-4", TONES[tone], className)}>
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />
      <div className="min-w-0 flex-1 space-y-1">
        <h3 className="font-semibold">{title}</h3>
        <div className="text-sm text-foreground/85">{children}</div>
        {meta ? <div className="pt-1">{meta}</div> : null}
        {action ? <div className="pt-2">{action}</div> : null}
      </div>
    </article>
  );
}
