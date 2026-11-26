"use client";
import { createColumnHelper, flexRender, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable, type SortingState, type VisibilityState } from "@tanstack/react-table";
import { ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Download, FileText, Plus, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsArrayOf, parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/agri/empty-state";
import { RangeTabs } from "@/components/agri/range-tabs";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Button, Card, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { ApiError } from "@/lib/api/browser";
import { useCommodities, useCreateReport, useHistoryMany, useMe, useSubscription } from "@/lib/api/queries";
import { downloadText, toCsv } from "@/lib/csv";
import { number, unitLabel } from "@/lib/format";
import { cn, pick } from "@/lib/utils";
import { PageTitle, UpgradePrompt } from "./common";
import { MarketSelect } from "./forecast";
import { isoDay } from "./reports";

const RANGES = ["1M", "3M", "6M", "1Y", "ALL"] as const;
const INTERVALS = ["day", "week"] as const;
const MAX = 5;
const RANGE_DAYS: Record<(typeof RANGES)[number], number> = { "1M": 30, "3M": 91, "6M": 182, "1Y": 365, ALL: 3650 };

export type ExplorerRow = { date: string; commodityId: string; commodity: string; avg: number; min: number | null; max: number | null; n: number | null; currency: string; unit: string };

/** History series → long-format rows (one per date × commodity), newest first. Exported for tests. */
export function toRows(series: { commodityId: string; name: string; currency: string; unit: string; points: { t: string; avg: string; min?: string; max?: string; n?: number }[] }[]): ExplorerRow[] {
  const num = (v?: string) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  return series.flatMap((s) => s.points.filter((p) => num(p.avg) != null).map((p) => ({
    date: p.t.slice(0, 10), commodityId: s.commodityId, commodity: s.name, avg: Number(p.avg), min: num(p.min), max: num(p.max), n: p.n ?? null, currency: s.currency, unit: s.unit,
  }))).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.commodity.localeCompare(b.commodity)));
}

const col = createColumnHelper<ExplorerRow>();

/** /app/data (mockup: Data explorer). Selection lives in the URL; the table is client-side over the API's series. */
export function DataExplorer() {
  const t = useTranslations("rep");
  const tc = useTranslations("cmd");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const commodities = useCommodities(cc);
  const sub = useSubscription();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const create = useCreateReport();
  const [ids, setIds] = useQueryState("c", parseAsArrayOf(parseAsString).withDefault([]));
  const [range, setRange] = useQueryState("range", parseAsStringLiteral(RANGES).withDefault("3M"));
  const [interval, setInterval] = useQueryState("interval", parseAsStringLiteral(INTERVALS).withDefault("day"));
  const [market] = useQueryState("market", parseAsString);
  const [sorting, setSorting] = useState<SortingState>([{ id: "date", desc: true }]);
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const [exported, setExported] = useState(false);
  const [locked, setLocked] = useState<string | null>(null);
  const list = commodities.data?.data ?? [];
  const chosen = ids.filter((id) => list.some((c) => c.id === id)).slice(0, MAX);
  const allowed = sub.data?.entitlements?.history_range;
  const history = useHistoryMany(chosen, cc, range, market ?? undefined, interval);
  const pending = history.some((h) => h.isPending);
  const err402 = history.find((h) => h.error instanceof ApiError && h.error.status === 402)?.error as ApiError | undefined;
  const nameOf = (id: string) => pick(list.find((c) => c.id === id)?.name, locale);

  const rows = useMemo(() => toRows(history.flatMap((h, i) => (h.data ? [{ commodityId: chosen[i]!, name: nameOf(chosen[i]!), currency: h.data.currency, unit: h.data.unit, points: h.data.points }] : []))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history.map((h) => h.dataUpdatedAt).join(","), chosen.join(","), locale]);

  const fmt = (v: number | null) => (v == null ? "—" : number(v, locale, { digits: 2 }));
  const columns = useMemo(() => [
    col.accessor("date", { header: t("date"), cell: (c) => <time dateTime={c.getValue()}>{new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${c.getValue()}T00:00:00Z`))}</time> }),
    col.accessor("commodity", { header: t("commodity") }),
    col.accessor("avg", { header: t("average"), cell: (c) => fmt(c.getValue()), meta: { end: true } }),
    col.accessor("min", { header: t("low"), cell: (c) => fmt(c.getValue()), sortUndefined: "last", meta: { end: true } }),
    col.accessor("max", { header: t("high"), cell: (c) => fmt(c.getValue()), sortUndefined: "last", meta: { end: true } }),
    col.accessor("n", { header: t("reports"), cell: (c) => (c.getValue() == null ? "—" : number(c.getValue()!, locale)), meta: { end: true } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [locale, t]);
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows, columns, state: { sorting, columnVisibility: visibility }, onSortingChange: setSorting, onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(), initialState: { pagination: { pageSize: 50 } },
  });
  const units = [...new Set(rows.map((r) => `${r.currency}/${unitLabel(r.unit)}`))].join(", ");

  const csv = () => {
    const vis = table.getVisibleLeafColumns().map((c) => c.id as keyof ExplorerRow);
    const header = [...vis.map((k) => String(columns.find((c) => (c as { accessorKey?: string }).accessorKey === k)?.header ?? k)), "currency", "unit"];
    const body = table.getSortedRowModel().rows.map((r) => [...vis.map((k) => r.original[k] as string | number | null), r.original.currency, r.original.unit]);
    downloadText(`agriprice-${cc.toLowerCase()}-${range}-${isoDay(new Date())}.csv`, toCsv(header, body));
  };
  const exportFull = () => {
    const to = isoDay(new Date()), from = isoDay(new Date(Date.now() - RANGE_DAYS[range] * 86_400_000));
    create.mutate({ type: "crop_price", format: "csv", country: cc, from, to, priceType: "wholesale", commodityIds: chosen, ...(market ? { marketIds: [market] } : {}) }, {
      onSuccess: () => { setExported(true); setLocked(null); fb.success(t("exportQueued")); },
      onError: (x) => (x instanceof ApiError && x.status === 402 ? setLocked(x.detail ?? "") : fb.error(problem(x as never))),
    });
  };

  return (
    <div className="space-y-5">
      <PageTitle title={t("explorer")} subtitle={t("explorerIntro")} />
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {chosen.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-muted py-1 ps-3 pe-1 text-sm">
              {nameOf(id)}
              <button type="button" onClick={() => setIds(chosen.filter((x) => x !== id))} aria-label={t("remove", { name: nameOf(id) })} className="rounded-full p-1 hover:bg-background"><X className="size-3.5" /></button>
            </span>
          ))}
          {chosen.length < MAX ? (
            <label className="inline-flex items-center gap-1 text-sm">
              <Plus aria-hidden className="size-4 text-brand" /><span className="sr-only">{t("addCommodity")}</span>
              <select value="" onChange={(e) => e.target.value && setIds([...chosen, e.target.value])} aria-label={t("addCommodity")} disabled={!list.length}
                className="h-9 rounded-xl border border-border bg-background px-2 text-sm">
                <option value="">{t("addCommodity")}</option>
                {list.filter((c) => !chosen.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{pick(c.name, locale)}</option>)}
              </select>
            </label>
          ) : <span className="text-xs text-muted-fg">{t("tooMany", { n: MAX })}</span>}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <MarketSelect cc={cc} allLabel={tc("allMarkets")} />
          <RangeTabs size="sm" label={t("range")} value={range} onChange={(v) => setRange(v === "3M" ? null : v)}
            options={RANGES.map((r) => ({ value: r, label: r }))} />
          <RangeTabs size="sm" label={t("interval")} value={interval} onChange={(v) => setInterval(v === "day" ? null : v)} options={INTERVALS.map((i) => ({ value: i, label: t(`interval_${i}`) }))} />
        </div>
        {allowed && !allowed.includes(range) ? <p className="text-xs text-muted-fg">{t("lockedRange", { range })}</p> : null}
      </Card>

      {locked != null ? <UpgradePrompt detail={locked || undefined} /> : null}
      {!chosen.length ? <EmptyState title={t("pickToStart")} /> : err402 ? <UpgradePrompt detail={err402.detail} /> : pending && !rows.length ? <Skeleton className="h-96" /> : !rows.length ? <EmptyState title={t("noRows")} /> : (
        <Card className="space-y-3 p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
            <p className="text-sm text-muted-fg">{t("rows", { n: rows.length })}{units ? ` · ${units}` : ""}</p>
            <div className="flex flex-wrap items-center gap-2">
              <details className="relative">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm"><Columns3 aria-hidden className="size-4" />{t("columns")}</summary>
                <div className="absolute end-0 z-10 mt-1 w-44 space-y-1 rounded-xl border border-border bg-card p-2 shadow-md">
                  {table.getAllLeafColumns().filter((c) => c.id !== "date").map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.getIsVisible()} onChange={c.getToggleVisibilityHandler()} className="size-4 accent-brand" />{String(c.columnDef.header)}</label>
                  ))}
                </div>
              </details>
              <Button variant="outline" size="sm" onClick={csv}><Download aria-hidden className="size-4" />{t("downloadCsv")}</Button>
              <Button size="sm" onClick={exportFull} disabled={create.isPending}><FileText aria-hidden className="size-4" />{t("exportFull")}</Button>
              {exported ? <Link href="/app/reports" className="text-sm font-semibold text-brand hover:underline">{t("openReports")}</Link> : null}
            </div>
          </div>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("explorer")}>
            <table className="w-full min-w-[40rem] text-sm">
              <caption className="sr-only">{t("explorer")}{units ? ` (${units})` : ""}</caption>
              <thead className="bg-muted text-muted-fg">
                {table.getHeaderGroups().map((g) => (
                  <tr key={g.id}>
                    {g.headers.map((h) => {
                      const end = (h.column.columnDef.meta as { end?: boolean } | undefined)?.end;
                      const s = h.column.getIsSorted();
                      return (
                        <th key={h.id} scope="col" aria-sort={s === "asc" ? "ascending" : s === "desc" ? "descending" : "none"} className={cn("px-4 py-2 font-medium", end ? "text-end" : "text-start")}>
                          <button type="button" onClick={h.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 hover:text-foreground">
                            {flexRender(h.column.columnDef.header, h.getContext())}<ArrowUpDown aria-hidden className="size-3.5" />
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    {r.getVisibleCells().map((c) => {
                      const end = (c.column.columnDef.meta as { end?: boolean } | undefined)?.end;
                      return c.column.id === "date"
                        ? <th key={c.id} scope="row" className="px-4 py-2 text-start font-normal">{flexRender(c.column.columnDef.cell, c.getContext())}</th>
                        : <td key={c.id} className={cn("px-4 py-2", end && "text-end tabular")}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {table.getPageCount() > 1 ? (
            <nav aria-label={t("page", { page: table.getState().pagination.pageIndex + 1, pages: table.getPageCount() })} className="flex items-center justify-end gap-2 px-4 pb-4 text-sm">
              <span className="text-muted-fg">{t("page", { page: table.getState().pagination.pageIndex + 1, pages: table.getPageCount() })}</span>
              <button type="button" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label={t("prev")} className="rounded-lg p-2 hover:bg-muted disabled:opacity-40"><ChevronLeft className="size-4 rtl:rotate-180" /></button>
              <button type="button" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label={t("next")} className="rounded-lg p-2 hover:bg-muted disabled:opacity-40"><ChevronRight className="size-4 rtl:rotate-180" /></button>
            </nav>
          ) : null}
        </Card>
      )}
    </div>
  );
}
