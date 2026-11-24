"use client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
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

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-muted p-1">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${value === o.value ? "bg-brand text-brand-fg" : "text-muted-fg hover:text-foreground"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
