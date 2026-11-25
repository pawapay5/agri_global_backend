"use client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { RangeTabs } from "@/components/agri/range-tabs";
import { Card, Skeleton } from "@/components/ui/primitives";
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
    return (
      <Card role="alert" className="text-sm">
        <p>{e?.status === 402 ? e.detail ?? t("error") : t("error")}</p>
        <button onClick={() => q.refetch()} className="mt-2 font-semibold text-brand hover:underline">↻</button>
      </Card>
    );
  }
  if (q.data === undefined || (empty && empty(q.data))) return null;
  return <>{children(q.data)}</>;
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="text-2xl font-bold">{title}</h1>{subtitle ? <p className="mt-1 text-sm text-muted-fg">{subtitle}</p> : null}</div>
      {actions}
    </div>
  );
}

/** Back-compat name for RangeTabs (radiogroup with arrow-key navigation). */
export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return <RangeTabs {...props} />;
}
