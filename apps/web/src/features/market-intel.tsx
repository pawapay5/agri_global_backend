"use client";
import { TrendingUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsNumberLiteral, useQueryStates } from "nuqs";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChangeBadge } from "@/components/agri/change-badge";
import { EmptyState } from "@/components/agri/empty-state";
import { RangeTabs } from "@/components/agri/range-tabs";
import { Card, CardTitle, Skeleton } from "@/components/ui/primitives";
import { ApiError } from "@/lib/api/browser";
import { useDemand, useSupply } from "@/lib/api/community";
import { useMe } from "@/lib/api/queries";
import { number, pctPlain, relativeTime } from "@/lib/format";
import { PageTitle, UpgradePrompt } from "./common";
import { CommodityPicker, useCommodityChoice } from "./markets-nav";

const WEEKS = [13, 26, 52] as const;

/** /app/tools/market-intel: weekly demand index (100 = usual) and listed supply by region for one crop. */
export function MarketIntel() {
  const t = useTranslations("tools");
  const td = useTranslations("ds");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const choice = useCommodityChoice(cc);
  const [q, setQ] = useQueryStates({ weeks: parseAsNumberLiteral(WEEKS).withDefault(26) });
  const demand = useDemand(cc, choice.id, q.weeks);
  const supply = useSupply(cc, choice.id);
  const [table, setTable] = useState(false);
  const locked = [demand.error, supply.error].find((e) => e instanceof ApiError && e.status === 402) as ApiError | undefined;
  const pts = (demand.data?.points ?? []).filter((p) => p.index != null) as { week: string; index: number }[];
  const day = (d: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`));

  return (
    <div className="space-y-5">
      <PageTitle title={t("intel")} subtitle={t("intelBody")} />
      <div className="flex flex-wrap items-end gap-3">
        <CommodityPicker choice={choice} />
        <RangeTabs size="sm" label={t("weeks")} value={String(q.weeks) as `${(typeof WEEKS)[number]}`} onChange={(v) => void setQ({ weeks: Number(v) === 26 ? null : (Number(v) as (typeof WEEKS)[number]) })} options={WEEKS.map((w) => ({ value: String(w) as `${typeof w}`, label: t(`w_${w}`) }))} />
      </div>
      {locked ? <UpgradePrompt detail={locked.detail} /> : (
        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="space-y-3 lg:col-span-3">
            <CardTitle>{t("demand")}</CardTitle>
            <p className="text-sm text-muted-fg">{t("demandIntro")}</p>
            {demand.isPending ? <Skeleton className="h-64" /> : !pts.length ? <EmptyState icon={TrendingUp} title={t("noIntel")} /> : (
              <>
                <figure aria-label={`${t("demand")} · ${t(`w_${q.weeks}`)}`} className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={pts} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                      <XAxis dataKey="week" tickFormatter={day} tick={{ fontSize: 11, fill: "var(--muted-fg)" }} axisLine={false} tickLine={false} minTickGap={28} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--muted-fg)" }} axisLine={false} tickLine={false} width={36} domain={["auto", "auto"]} />
                      <ReferenceLine y={100} stroke="var(--muted-fg)" strokeDasharray="4 4" />
                      <Tooltip labelFormatter={(l) => day(String(l))} formatter={(v) => [number(Number(v), locale, { digits: 0 }), t("demand")]} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }} />
                      <Line type="monotone" dataKey="index" stroke="var(--chart-history)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </figure>
                <button type="button" onClick={() => setTable((x) => !x)} aria-expanded={table} aria-controls="mi-table" className="text-xs font-semibold text-brand hover:underline">{table ? td("hideTable") : td("viewTable")}</button>
                <div id="mi-table" hidden={!table} className="max-h-64 overflow-auto rounded-xl border border-border" tabIndex={table ? 0 : -1} role="region" aria-label={t("demand")}>
                  <table className="w-full text-sm"><caption className="sr-only">{t("demand")}</caption><tbody>{pts.map((p) => <tr key={p.week} className="border-t border-border first:border-0"><th scope="row" className="px-3 py-1.5 text-start font-normal">{day(p.week)}</th><td className="px-3 py-1.5 text-end tabular">{number(p.index, locale, { digits: 0 })}</td></tr>)}</tbody></table>
                </div>
              </>
            )}
            {demand.data?.byRegion?.length ? (
              <div><h3 className="text-sm font-semibold">{t("byRegion")}</h3>
                <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">{[...demand.data.byRegion].sort((a, b) => (b.index ?? -1) - (a.index ?? -1)).map((r) => <li key={r.regionId} className="flex justify-between gap-2 border-b border-border py-1"><span>{r.name}</span><span className="tabular">{r.index == null ? "—" : number(r.index, locale, { digits: 0 })}</span></li>)}</ul>
              </div>
            ) : null}
          </Card>
          <Card className="space-y-3 p-0 lg:col-span-2">
            <div className="px-5 pt-5"><CardTitle>{t("supply")}</CardTitle>
              {supply.data ? <p className="mt-1 text-sm text-muted-fg">{t("totalKg", { kg: number(supply.data.totalKg ?? 0, locale) })}{supply.data.snapshotAt ? ` · ${t("snapshot", { time: relativeTime(supply.data.snapshotAt, locale) })}` : ""}</p> : null}
            </div>
            {supply.isPending ? <Skeleton className="m-5 h-48" /> : !supply.data?.regions?.length ? <p className="px-5 pb-5 text-sm text-muted-fg">{t("noIntel")}</p> : (
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("supply")}>
                <table className="w-full min-w-[26rem] text-sm">
                  <caption className="sr-only">{t("supply")}</caption>
                  <thead className="bg-muted text-muted-fg"><tr><th scope="col" className="px-4 py-2 text-start font-medium">{t("region")}</th><th scope="col" className="px-4 py-2 text-end font-medium">kg</th><th scope="col" className="px-4 py-2 text-end font-medium">{t("share")}</th><th scope="col" className="px-4 py-2 text-end font-medium">{t("change4w")}</th></tr></thead>
                  <tbody>
                    {[...supply.data.regions].sort((a, b) => (b.quantityKg ?? 0) - (a.quantityKg ?? 0)).map((r, i) => (
                      <tr key={r.regionId ?? i} className="border-t border-border">
                        <th scope="row" className="px-4 py-2 text-start font-normal">{r.name}<span className="block text-xs text-muted-fg">{t("listings")}: {r.listings ?? 0} · {t("sellers")}: {r.sellers ?? 0}</span></th>
                        <td className="px-4 py-2 text-end tabular">{number(r.quantityKg ?? 0, locale)}</td>
                        <td className="px-4 py-2 text-end tabular">{pctPlain(r.sharePct ?? 0, locale, 0)}</td>
                        <td className="px-4 py-2 text-end"><ChangeBadge value={r.change4wPct} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
