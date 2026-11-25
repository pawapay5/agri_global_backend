import { CircleDashed, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * "Not enough data" and other empty states. When the API returns reason codes (e.g. insufficient_history),
 * they're listed in plain language from the `app.reasons.*` messages; unknown codes are shown as-is rather
 * than hidden. Never shows a placeholder number.
 */
export function EmptyState({ title, description, reasons, action, icon: Icon = CircleDashed, className }: {
  title?: string; description?: string; reasons?: string[] | null; action?: ReactNode; icon?: LucideIcon; className?: string;
}) {
  const t = useTranslations();
  return (
    <div role="status" className={cn("flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center", className)}>
      <Icon aria-hidden className="size-8 text-muted-fg" />
      <p className="font-semibold">{title ?? t("ds.emptyTitle")}</p>
      {description ? <p className="max-w-md text-sm text-muted-fg">{description}</p> : null}
      {reasons?.length ? (
        <ul className="max-w-md list-disc space-y-1 ps-5 text-start text-sm text-muted-fg">
          {reasons.map((r) => <li key={r}>{t.has(`app.reasons.${r}`) ? t(`app.reasons.${r}`) : r.replace(/_/g, " ")}</li>)}
        </ul>
      ) : !description ? <p className="text-sm text-muted-fg">{t("ds.emptyGeneric")}</p> : null}
      {action}
    </div>
  );
}
