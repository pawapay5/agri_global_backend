"use client";
import { Sprout } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";
import { useState } from "react";
import { ChangeBadge } from "@/components/agri/change-badge";
import { CropCalendar } from "@/components/agri/crop-calendar";
import { EmptyState } from "@/components/agri/empty-state";
import { monthName } from "@/components/agri/seasonal-bars";
import { Card, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { useMe, usePlanting, useRegions } from "@/lib/api/queries";
import { number } from "@/lib/format";
import { pick } from "@/lib/utils";
import { PageTitle, QueryState } from "./common";

/** /app/insights/planting (mockup: Planting advisor). Region and month in the URL; month defaults to this month. */
export function PlantingInsights() {
  const t = useTranslations("ins");
  const locale = useLocale();
  const me = useMe();
  const regions = useRegions(me.data?.country ?? "");
  const [region, setRegion] = useQueryState("region", parseAsString);
  const [thisMonth] = useState(() => new Date().getUTCMonth() + 1);
  const [month, setMonth] = useQueryState("month", parseAsInteger.withDefault(thisMonth));
  const m = month >= 1 && month <= 12 ? month : thisMonth;
  const planting = usePlanting(region ?? "", m);
  const list = [...(regions.data ?? [])].filter((r) => r.level === 1 || !r.parentId).sort((a, b) => pick(a.name, locale).localeCompare(pick(b.name, locale), locale));
  const select = "h-10 min-w-44 rounded-xl border border-border bg-background px-3 text-sm text-foreground";

  return (
    <div className="space-y-5">
      <PageTitle title={t("plantingTitle")} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-fg">{t("region")}
          <select value={region ?? ""} onChange={(e) => setRegion(e.target.value || null)} className={select} disabled={!list.length}>
            <option value="">{t("chooseRegion")}</option>
            {list.map((r) => <option key={r.id} value={r.id}>{pick(r.name, locale)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-fg">{t("month")}
          <select value={m} onChange={(e) => setMonth(Number(e.target.value) === thisMonth ? null : Number(e.target.value))} className={select}>
            {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{monthName(i + 1, locale, "long")}</option>)}
          </select>
        </label>
      </div>
      {!region ? <EmptyState icon={Sprout} title={t("pickRegion")} /> : (
        <QueryState q={planting} skeleton={<Skeleton className="h-72" />}>
          {(rows) => !rows.length ? <EmptyState title={t("noPlanting")} /> : (
            <ol className="grid gap-4 md:grid-cols-2">
              {[...rows].sort((a, b) => b.score - a.score).map((p) => (
                <li key={p.commodityId}>
                  <Card className="h-full space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <Link href={`/app/commodities/${p.commodityId}`} className="text-lg font-semibold hover:text-brand hover:underline">{pick(p.commodityName, locale)}</Link>
                      <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold tabular">{t("score", { n: number(Math.round(p.score), locale) })}</span>
                    </div>
                    <CropCalendar plantingMonths={p.plantingWindow} harvestMonths={p.harvestMonths} />
                    {p.expectedHarvestPriceChangePct != null ? (
                      <p className="flex flex-wrap items-center gap-2 text-sm">{t("harvestPriceLabel")}<ChangeBadge value={p.expectedHarvestPriceChangePct} /></p>
                    ) : null}
                    {p.reasons.length ? (
                      <div className="text-sm"><p className="font-medium">{t("why")}</p><ul className="ms-5 list-disc text-muted-fg">{p.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ol>
          )}
        </QueryState>
      )}
    </div>
  );
}
