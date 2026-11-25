"use client";
import { Clock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { absoluteTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * "Updated 2 hours ago · Source: WFP, MoFA" next to every price and forecast. Time comes from the API
 * (observedAt / generatedAt). Sources render only when the API reports them; otherwise nothing is claimed.
 * Relative time re-renders each minute, so a cached page never shows a stale "just now".
 */
export function DataFreshness({ at, sources, className }: { at: string | null | undefined; sources?: string[] | null; className?: string }) {
  const t = useTranslations("ds");
  const locale = useLocale();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  if (!at) return null;
  const names = (sources ?? []).filter(Boolean);
  return (
    <p className={cn("flex flex-wrap items-center gap-x-1.5 text-xs text-muted-fg", className)}>
      <Clock aria-hidden className="size-3.5" />
      <time dateTime={at} title={absoluteTime(at, locale)} suppressHydrationWarning>{t("updated", { time: relativeTime(at, locale, now) })}</time>
      {names.length ? <><span aria-hidden>·</span><span>{t("sources", { sources: names.join(", ") })}</span></> : null}
    </p>
  );
}
