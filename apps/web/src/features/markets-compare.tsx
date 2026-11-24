"use client";
import { createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type SortingState } from "@tanstack/react-table";
import { useLocale, useTranslations } from "next-intl";
import { parseAsArrayOf, parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Change } from "@/components/price/change";
import { Card } from "@/components/ui/primitives";
import { useCommodities, useCompare, useMarkets, useMe } from "@/lib/api/queries";
import type { S } from "@/lib/api/browser";
import { formatMoney, formatPct, pick } from "@/lib/utils";
import { PageTitle, QueryState, Segmented } from "./common";

type Row = S["MarketComparison"]["markets"][number];
const col = createColumnHelper<Row>();

export function MarketsCompare() {
  const t = useTranslations("app");
  const tp = useTranslations("prices");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const commodities = useCommodities(cc);
  const markets = useMarkets(cc);
  const [commodity, setCommodity] = useQueryState("commodity", parseAsString);
  const [selected, setSelected] = useQueryState("markets", parseAsArrayOf(parseAsString).withDefault([]));
  const [view, setView] = useQueryState("view", parseAsStringLiteral(["chart", "table"] as const).withDefault("chart"));
  const [range, setRange] = useQueryState("range", parseAsStringLiteral(["1M", "3M", "6M", "1Y"] as const).withDefault("1M"));
  const commodityId = commodity ?? commodities.data?.data[0]?.id ?? "";
  const marketIds = selected.length >= 2 ? selected : (markets.data?.data ?? []).slice(0, 6).map((m) => m.id);
  const compare = useCompare(commodityId, marketIds, range);
  const [sorting, setSorting] = useState<SortingState>([{ id: "latest", desc: false }]);

  const columns = useMemo(() => [
    col.accessor((r) => pick(r.marketName, locale), { id: "market", header: tp("market") }),
    col.accessor((r) => (r.latest ? Number(r.latest.value.display.amount) : null), {
      id: "latest", header: tp("price"), sortUndefined: "last",
      cell: (c) => (c.row.original.latest ? formatMoney(c.row.original.latest.value.display.amount, c.row.original.latest.value.display.currency, locale) : "—"),
    }),
    col.accessor((r) => (r.stats.average ? Number(r.stats.average) : null), { id: "average", header: tp("average"), cell: (c) => (c.getValue() != null ? Number(c.getValue()).toFixed(2) : "—") }),
    col.accessor((r) => r.stats.changePctWoW, { id: "change", header: tp("change"), cell: (c) => <Change pct={c.getValue()} /> }),
    col.accessor((r) => r.stats.volatility.label, { id: "vol", header: tp("volatility"), cell: (c) => <span className="capitalize">{(c.getValue() ?? "").replace("_", " ")}</span> }),
  ], [locale, tp]);

  const table = useReactTable({ data: compare.data?.markets ?? [], columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });

  return (
    <div className="space-y-6">
      <PageTitle title={t("comparison")} actions={
        <div className="flex flex-wrap gap-2">
          <select aria-label={t("selectCommodity")} value={commodityId} onChange={(e) => setCommodity(e.target.value)} className="h-10 rounded-xl border border-border bg-background px-3 text-sm">
            {commodities.data?.data.map((c) => <option key={c.id} value={c.id}>{pick(c.name, locale)}</option>)}
          </select>
          <Segmented label="Range" value={range} onChange={setRange} options={(["1M", "3M", "6M", "1Y"] as const).map((r) => ({ value: r, label: r }))} />
          <Segmented label="View" value={view} onChange={setView} options={[{ value: "chart", label: t("chartView") }, { value: "table", label: t("tableView") }]} />
        </div>
      } />

      <details className="rounded-xl border border-border bg-card p-3">
        <summary className="cursor-pointer text-sm font-semibold">{t("selectMarket")} ({marketIds.length})</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {markets.data?.data.map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-[var(--brand)]" checked={marketIds.includes(m.id)}
                onChange={(e) => setSelected(e.target.checked ? [...new Set([...marketIds, m.id])].slice(0, 10) : marketIds.filter((x) => x !== m.id))} />
              {pick(m.name, locale)}
            </label>
          ))}
        </div>
      </details>

      <QueryState q={compare}>
        {(d) => (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Card><p className="text-xs text-muted-fg">{t("cheapest")}</p><p className="font-semibold">{pick(d.markets.find((m) => m.marketId === d.cheapestMarketId)?.marketName, locale) || "—"}</p></Card>
              <Card><p className="text-xs text-muted-fg">{t("priciest")}</p><p className="font-semibold">{pick(d.markets.find((m) => m.marketId === d.priciestMarketId)?.marketName, locale) || "—"}</p></Card>
              <Card><p className="text-xs text-muted-fg">{t("spread")}</p><p className="font-semibold text-forecast">{formatPct(d.spreadPct)}</p></Card>
            </div>
            {view === "chart" ? (
              <Card>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={d.markets.filter((m) => m.latest).map((m) => ({ name: pick(m.marketName, locale).split(" (")[0], v: Number(m.latest!.value.display.amount), id: m.marketId }))}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="name" fontSize={12} stroke="var(--muted-fg)" interval={0} angle={-20} textAnchor="end" height={60} />
                    <YAxis fontSize={12} stroke="var(--muted-fg)" width={48} />
                    <Tooltip formatter={(v) => formatMoney(v as number, d.currency, locale)} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }} />
                    <Bar dataKey="v" radius={[6, 6, 0, 0]}>
                      {d.markets.filter((m) => m.latest).map((m) => <Cell key={m.marketId} fill={m.marketId === d.cheapestMarketId ? "var(--up)" : m.marketId === d.priciestMarketId ? "var(--down)" : "var(--leaf)"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="mt-2 text-xs text-muted-fg">{d.currency}/{d.unit}</p>
              </Card>
            ) : (
              <Card className="overflow-x-auto p-0">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead className="bg-muted text-muted-fg">
                    {table.getHeaderGroups().map((hg) => (
                      <tr key={hg.id}>{hg.headers.map((h) => (
                        <th key={h.id} scope="col" className="px-4 py-2 text-start" aria-sort={h.column.getIsSorted() === "asc" ? "ascending" : h.column.getIsSorted() === "desc" ? "descending" : "none"}>
                          <button onClick={h.column.getToggleSortingHandler()} className="font-semibold">{flexRender(h.column.columnDef.header, h.getContext())}{{ asc: " ↑", desc: " ↓" }[h.column.getIsSorted() as string] ?? ""}</button>
                        </th>
                      ))}</tr>
                    ))}
                  </thead>
                  <tbody>{table.getRowModel().rows.map((r) => <tr key={r.id} className="border-t border-border">{r.getVisibleCells().map((c) => <td key={c.id} className="px-4 py-3 tabular">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}</tr>)}</tbody>
                </table>
              </Card>
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}
