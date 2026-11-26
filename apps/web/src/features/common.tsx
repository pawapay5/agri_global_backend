"use client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { RangeTabs } from "@/components/agri/range-tabs";
import { Sparkles } from "lucide-react";
import { buttonVariants, Card, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { ApiError } from "@/lib/api/browser";

/** Uniform loading / error / empty handling for TanStack Query results. */
export function QueryState<T>({ q, empty, skeleton, children }: {
  q: { isPending: boolean; isError: boolean; error: unknown; data: T | undefined; refetch: () => unknown };
  empty?: (d: T) => boolean; skeleton?: ReactNode; children: (d: T) => ReactNode;
}) {
  const t = useTranslations("app");
  if (q.isPending) return <>{skeleton ?? <Skeleton className="h-32" />}</>;
  if (q.isError) {
    const e = q.error instanceof ApiError ? q.error : null;
    // 402 = the user's plan doesn't include this; retrying won't help, upgrading will.
    if (e?.status === 402) return <UpgradePrompt detail={e.detail} />;
    return (
      <Card role="alert" className="text-sm">
        <p>{t("error")}</p>
        <button onClick={() => q.refetch()} className="mt-2 font-semibold text-brand hover:underline">↻</button>
      </Card>
    );
  }
  if (q.data === undefined || (empty && empty(q.data))) return null;
  return <>{children(q.data)}</>;
}

/** Shown when the API answers 402: names what's locked (the API's own detail) and links to the plans. */
export function UpgradePrompt({ detail }: { detail?: string }) {
  const t = useTranslations("ins");
  return (
    <Card className="flex flex-wrap items-center gap-4 bg-info">
      <Sparkles aria-hidden className="size-6 shrink-0 text-brand" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{t("upgradeTitle")}</p>
        <p className="text-sm text-muted-fg">{detail ?? t("upgradeBody")}</p>
      </div>
      <Link href="/app/billing" className={buttonVariants({ size: "sm" })}>{t("seePlans")}</Link>
    </Card>
  );
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0"><h1 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>{subtitle ? <p className="mt-1.5 max-w-3xl text-sm text-muted-fg sm:text-base">{subtitle}</p> : null}</div>
      {actions}
    </div>
  );
}

/** Back-compat name for RangeTabs (radiogroup with arrow-key navigation). */
export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return <RangeTabs {...props} />;
}
