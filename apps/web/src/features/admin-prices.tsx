"use client";
import { AlertTriangle, Check, CheckCircle2, ClipboardCheck, Clock, FileUp, Flag, X, XCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useState } from "react";
import { ColumnChart, LineChart, RankedBars, SegmentedBar, VizCard } from "@/components/agri/charts/viz";
import { EmptyState } from "@/components/agri/empty-state";
import { RangeTabs } from "@/components/agri/range-tabs";
import { StatCard } from "@/components/agri/stat-card";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Badge, Button, Card, CardTitle, FieldError, Input, Label, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import type { S } from "@/lib/api/browser";
import { field, useAdminStats, useAuditLog, useCountries, useImportPrices, useModels, useReviewPrice, useReviewQueue, type Row } from "@/lib/api/admin";
import { money, number, relativeTime, shortDate, unitLabel } from "@/lib/format";
import { cn, pick } from "@/lib/utils";

/**
 * /admin: exact queue totals, data intake by review status, sign-ups, people by role, orders by status and forecast
 * confidence, for the chosen period (one filter row scopes every chart). Then pipeline health, models and recent audit
 * entries. Every chart has a table view.
 */
const DAYS = ["7", "30", "90"] as const;
const OTHER_AFTER = 5;
const STATUS_SERIES = [
  { key: "approved", color: "var(--status-good)", icon: CheckCircle2 },
  { key: "pending", color: "var(--status-warning)", icon: Clock },
  { key: "flagged", color: "var(--status-serious)", icon: Flag },
  { key: "rejected", color: "var(--status-critical)", icon: XCircle },
] as const;
const CONFIDENCE = ["high", "medium", "low"] as const;

/** Top roles get the first five categorical slots in a fixed order; the rest fold into "Other" (exported for tests). */
export function roleParts(byRole: { role: string; count: number }[]) {
  const sorted = [...byRole].sort((a, b) => b.count - a.count);
  const head = sorted.slice(0, OTHER_AFTER), tail = sorted.slice(OTHER_AFTER);
  const other = tail.reduce((a, r) => a + r.count, 0);
  return [...head.map((r, i) => ({ key: r.role, role: r.role, count: r.count, color: `var(--viz-${i + 1})` })),
    ...(other ? [{ key: "other", role: "other", count: other, color: "var(--viz-other)" }] : [])];
}

export function AdminOverview() {
  const t = useTranslations("adm");
  const tm = useTranslations("mp");
  const locale = useLocale();
  const [q, setQ] = useQueryStates({ days: parseAsStringLiteral(DAYS).withDefault("30") });
  const days = Number(q.days) as 7 | 30 | 90;
  const stats = useAdminStats(days);
  const models = useModels();
  const audit = useAuditLog({}, 8);
  const s = stats.data;
  const m = models.data as { versions?: Row[]; pipelines?: Row[] } | undefined;
  const fmt = (v: number) => number(v, locale, { compact: v >= 10_000 });
  const day = (d: string) => shortDate(d, locale);
  const fetching = stats.isFetching && !stats.isPending;
  const roleName = (r: string) => (t.has(`role_${r}`) ? t(`role_${r}` as "role_farmer") : r);
  const tiles: { label: string; value: number | null | undefined; href: string }[] = [
    { label: t("review"), value: s?.queues.pricesPending, href: "/admin/prices/review" },
    { label: `${t("review")} · ${t("st_flagged")}`, value: s?.queues.pricesFlagged, href: "/admin/prices/review?status=flagged" },
    { label: t("sellerApprovals"), value: s?.queues.sellerApplications, href: "/admin/kyc" },
    { label: t("moderation"), value: s?.queues.moderationOpen, href: "/admin/moderation" },
    { label: t("disputes"), value: s?.queues.disputesOpen, href: "/admin/disputes" },
    { label: t("payouts"), value: s?.queues.payoutsPending, href: "/admin/payouts" },
  ].filter((x) => x.value !== null);
  const statusSeries = STATUS_SERIES.map((x) => ({ key: x.key, name: t(`ps_${x.key}`), color: x.color, icon: <x.icon aria-hidden className="size-3" /> }));
  const roles = s ? roleParts(s.users.byRole) : [];
  const orderRows = s ? [...s.orders.byStatus].sort((a, b) => b.count - a.count) : [];
  const orderStatus = (st: string) => (tm.has(`status_${st}`) ? tm(`status_${st}` as "status_in_transit") : st);
  const confidenceByHorizon = s ? [1, 3, 6].map((h) => ({ h, parts: CONFIDENCE.map((c, i) => ({
    key: c, name: t(`conf_${c}`), value: s.forecastConfidence.filter((x) => x.horizonMonths === h && x.confidence === c).reduce((a, x) => a + x.count, 0),
    color: `var(--viz-ord-${3 - i})` })) })).filter((x) => x.parts.some((p) => p.value)) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("overview")}</h1>
          {s ? <p className="mt-1 text-sm text-muted-fg">{s.country ? t("scopeCountry", { country: s.country }) : t("scopeAll")} · <span suppressHydrationWarning>{t("updatedAgo", { when: relativeTime(s.generatedAt, locale) })}</span></p> : null}
        </div>
        <RangeTabs size="sm" label={t("period")} value={q.days} onChange={(v) => void setQ({ days: v === "30" ? null : v })} options={DAYS.map((d) => ({ value: d, label: t("lastDays", { n: Number(d) }) }))} />
      </div>

      {stats.isError ? <EmptyState title={t("statsFailed")} /> : (
        <div className={cn("grid grid-cols-2 gap-4 transition-opacity sm:grid-cols-3 xl:grid-cols-6", fetching && "opacity-60")}>
          {tiles.map((x, i) => (
            <Link key={x.href} href={x.href} className="viz-fade block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ ["--i" as string]: i }}>
              <StatCard label={x.label} value={x.value == null ? "…" : x.value ? number(x.value, locale) : t("nothingWaiting")} />
            </Link>
          ))}
        </div>
      )}

      {stats.isPending ? <div className="grid gap-6 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div> : s ? (
        <>
          <div className="grid gap-6 lg:grid-cols-5">
            <VizCard className="lg:col-span-3" title={t("intakeTitle")} subtitle={t("intakeSub", { n: days })} legend={statusSeries} fetching={fetching}
              table={{ caption: t("intakeTitle"), columns: [t("date"), ...statusSeries.map((x) => x.name)],
                rows: s.prices.map((p) => [day(p.date), p.approved, p.pending, p.flagged, p.rejected]) }}>
              {s.prices.every((p) => !p.approved && !p.pending && !p.flagged && !p.rejected) ? <p className="py-8 text-center text-sm text-muted-fg">{t("noIntake")}</p> : (
                <ColumnChart height={240} format={fmt} series={statusSeries} summary={t("intakeSummary", { n: s.prices.reduce((a, p) => a + p.approved + p.pending + p.flagged + p.rejected, 0), days })}
                  data={s.prices.map((p) => ({ key: p.date, label: day(p.date), values: [p.approved, p.pending, p.flagged, p.rejected] }))} />
              )}
            </VizCard>

            <VizCard className="lg:col-span-2" title={t("peopleTitle")} fetching={fetching}
              table={{ caption: t("peopleTitle"), columns: [t("role"), t("count")], rows: roles.map((r) => [r.role === "other" ? t("otherRoles") : roleName(r.role), number(r.count, locale)]) }}>
              <div className="space-y-5">
                <div>
                  <p className="text-5xl font-semibold tracking-tight">{number(s.users.total, locale)}</p>
                  <p className="mt-1 text-sm text-muted-fg">{t("newInPeriod", { n: number(s.users.newInPeriod, locale), days })}</p>
                </div>
                {roles.length ? (
                  <SegmentedBar label={t("peopleTitle")} format={(v) => number(v, locale)}
                    parts={roles.map((r) => ({ key: r.key, name: r.role === "other" ? t("otherRoles") : roleName(r.role), value: r.count, color: r.color }))} />
                ) : null}
              </div>
            </VizCard>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <VizCard title={t("signupsTitle")} subtitle={t("intakeSub", { n: days })} fetching={fetching}
              table={{ caption: t("signupsTitle"), columns: [t("date"), t("count")], rows: s.signups.map((p) => [day(p.date), p.count]) }}>
              <LineChart height={200} format={fmt} name={t("signupsTitle")} summary={t("newInPeriod", { n: number(s.users.newInPeriod, locale), days })}
                points={s.signups.map((p) => ({ key: p.date, label: day(p.date), value: p.count }))} />
            </VizCard>

            <VizCard title={t("ordersTitle")} subtitle={t("intakeSub", { n: days })} fetching={fetching}
              table={orderRows.length ? { caption: t("ordersTitle"), columns: [t("status"), t("count")], rows: orderRows.map((o) => [orderStatus(o.status), number(o.count, locale)]) } : undefined}>
              {orderRows.length ? <RankedBars rows={orderRows.map((o) => ({ key: o.status, label: orderStatus(o.status), value: o.count, display: number(o.count, locale) }))} />
                : <p className="py-8 text-center text-sm text-muted-fg">{t("noOrders")}</p>}
            </VizCard>

            <VizCard title={t("confidenceTitle")} subtitle={t("confidenceSub")}
              table={confidenceByHorizon.length ? { caption: t("confidenceTitle"), columns: [t("horizonCol"), ...CONFIDENCE.map((c) => t(`conf_${c}`))],
                rows: confidenceByHorizon.map((x) => [t("monthsAhead", { n: x.h }), ...x.parts.map((p) => p.value)]) } : undefined}>
              {confidenceByHorizon.length ? (
                <ul className="space-y-4">
                  {confidenceByHorizon.map((x) => (
                    <li key={x.h}><p className="mb-1.5 text-sm font-medium">{t("monthsAhead", { n: x.h })}</p>
                      <SegmentedBar label={`${t("confidenceTitle")}, ${t("monthsAhead", { n: x.h })}`} format={(v) => number(v, locale)} parts={x.parts} /></li>
                  ))}
                </ul>
              ) : <p className="py-8 text-center text-sm text-muted-fg">{t("noForecasts")}</p>}
            </VizCard>
          </div>
        </>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3">
          <CardTitle>{t("pipelines")}</CardTitle>
          {models.isPending ? <Skeleton className="h-32" /> : !m?.pipelines?.length ? <p className="text-sm text-muted-fg">{t("noRows")}</p> : (
            <ul className="divide-y divide-border text-sm">
              {m.pipelines.map((p, i) => {
                const st = String(field(p, "status") ?? ""), at = field<string>(p, "finishedAt") ?? field<string>(p, "startedAt");
                return <li key={i} className="flex flex-wrap items-center gap-2 py-2"><span className="flex-1 font-medium">{String(field(p, "flow"))} <span className="text-muted-fg">· {String(field(p, "countryIso2") ?? "")}</span></span><Badge tone={st === "succeeded" || st === "success" ? "up" : st === "failed" ? "down" : "forecast"}>{st}</Badge>{at ? <span className="text-xs text-muted-fg">{relativeTime(at, locale)}</span> : null}</li>;
              })}
            </ul>
          )}
        </Card>
        <Card className="space-y-3">
          <CardTitle>{t("recentActivity")}</CardTitle>
          {audit.isPending ? <Skeleton className="h-32" /> : !audit.data?.pages[0]?.data.length ? <p className="text-sm text-muted-fg">{t("noRows")}</p> : (
            <ul className="divide-y divide-border text-sm">
              {(audit.data.pages[0].data as Row[]).map((e, i) => <li key={String(field(e, "id") ?? i)} className="flex items-center gap-2 py-2"><code className="flex-1 truncate font-mono text-xs">{String(field(e, "action"))}</code><span className="text-xs text-muted-fg">{field<string>(e, "at") ? relativeTime(field<string>(e, "at")!, locale) : ""}</span></li>)}
            </ul>
          )}
          <Link href="/admin/audit" className="text-sm font-semibold text-brand hover:underline">{t("audit")} →</Link>
        </Card>
      </div>
      {m?.versions?.length ? (
        <Card className="space-y-2"><CardTitle>{t("latestModels")}</CardTitle>
          <ul className="flex flex-wrap gap-2 text-sm">{m.versions.slice(0, 4).map((v, i) => <li key={i}><Badge tone={field(v, "status") === "production" ? "up" : "neutral"}>{String(field(v, "name"))} v{String(field(v, "version"))}</Badge></li>)}</ul>
          <Link href="/admin/models" className="text-sm font-semibold text-brand hover:underline">{t("models")} →</Link>
        </Card>
      ) : null}
    </div>
  );
}

const STATUSES = ["pending", "flagged"] as const;

/** /admin/prices/review: approve or reject queued observations; rejecting needs a reason (it's audited). */
export function PriceReview() {
  const t = useTranslations("adm");
  const locale = useLocale();
  const countries = useCountries();
  const [f, setF] = useQueryStates({ status: parseAsStringLiteral(STATUSES).withDefault("pending"), country: parseAsString });
  const queue = useReviewQueue(f.country ?? undefined, f.status);
  const items = queue.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t("review")}</h1>
      <div className="flex flex-wrap items-end gap-3">
        <RangeTabs size="sm" label={t("status")} value={f.status} onChange={(v) => void setF({ status: v === "pending" ? null : v })} options={STATUSES.map((s) => ({ value: s, label: t(`st_${s}`) }))} />
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-fg">{t("country")}
          <select value={f.country ?? ""} onChange={(e) => void setF({ country: e.target.value || null })} className="h-9 rounded-xl border border-border bg-background px-2 text-sm text-foreground">
            <option value="">{t("allCountries")}</option>{(countries.data ?? []).map((c) => <option key={c.iso2} value={c.iso2}>{pick(c.name, locale) || c.iso2}</option>)}
          </select>
        </label>
      </div>
      {queue.isPending ? <Skeleton className="h-72" /> : !items.length ? <EmptyState icon={ClipboardCheck} title={t("nothingWaiting")} /> : (
        <ul className="space-y-3">{items.map((o) => <li key={o.id}><ReviewItem o={o} /></li>)}</ul>
      )}
      {queue.hasNextPage ? <Button variant="outline" onClick={() => void queue.fetchNextPage()}>{t("loadMore")}</Button> : null}
    </div>
  );
}

function ReviewItem({ o }: { o: S["ReviewQueueItem"] }) {
  const t = useTranslations("adm");
  const locale = useLocale();
  const review = useReviewPrice();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [bad, setBad] = useState(false);
  const d = o.value?.display;
  const act = (action: "approve" | "reject") => {
    if (action === "reject" && !reason.trim()) { setBad(true); document.getElementById(`rr-${o.id}`)?.focus(); return; }
    review.mutate({ id: o.id!, body: { action, ...(reason.trim() ? { reason: reason.trim().slice(0, 500) } : {}) } }, { onSuccess: () => fb.success(t(action === "approve" ? "approved" : "rejected")), onError: (x) => fb.error(problem(x as never)) });
  };
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{pick(o.commodityName, locale)} <span className="font-normal text-muted-fg">· {pick(o.marketName, locale)}</span></p>
          <p className="text-xs text-muted-fg">{t(`src_${o.source}`)} · {t("observed")} {o.observedAt ? relativeTime(o.observedAt, locale) : "—"}{o.outlierScore != null ? ` · ${t("outlier", { z: number(o.outlierScore, locale, { digits: 1 }) })}` : ""}</p>
        </div>
        <div className="text-end">
          <p className="text-lg font-semibold tabular">{d ? `${money(d.amount, d.currency, locale)}/${unitLabel(d.unit)}` : "—"}</p>
          {o.seriesMedianPerKg ? <p className="text-xs text-muted-fg">{t("median")}: <span className="tabular">{o.seriesMedianPerKg}</span></p> : null}
        </div>
      </div>
      {o.flags?.length ? <p className="flex flex-wrap items-center gap-1.5 text-xs"><AlertTriangle aria-hidden className="size-3.5 text-forecast-ink" />{t("flags")}: {o.flags.map((x) => <Badge key={x} tone="forecast">{x}</Badge>)}</p> : null}
      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
        <Button size="sm" onClick={() => act("approve")} disabled={review.isPending}><Check aria-hidden className="size-4" />{t("approve")}</Button>
        {rejecting ? (
          <>
            <div className="min-w-56 flex-1 space-y-1"><Label htmlFor={`rr-${o.id}`}>{t("rejectReason")}</Label><Input id={`rr-${o.id}`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} aria-invalid={bad} /></div>
            <Button size="sm" variant="outline" className="border-down text-down" onClick={() => act("reject")} disabled={review.isPending}><X aria-hidden className="size-4" />{t("reject")}</Button>
            <FieldError>{bad ? t("reasonRequired") : null}</FieldError>
          </>
        ) : <Button size="sm" variant="ghost" onClick={() => setRejecting(true)}>{t("reject")}…</Button>}
      </div>
    </Card>
  );
}

const MAX_CSV_MB = 20;

/** /admin/prices/import: dry run first; the real import unlocks only for the file that was checked. */
export function PriceImport() {
  const t = useTranslations("adm");
  const locale = useLocale();
  const countries = useCountries();
  const imp = useImportPrices();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [country, setCountry] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [checked, setChecked] = useState<{ key: string; report: S["ImportReport"] } | null>(null);
  const [result, setResult] = useState<S["ImportReport"] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = file ? `${file.name}:${file.size}:${file.lastModified}:${country}:${sourceId}` : "";
  const canImport = Boolean(checked && checked.key === key && checked.report.accepted + checked.report.flagged > 0);

  const run = async (dryRun: boolean) => {
    if (!country) { setErr(t("pickCountry")); return; }
    if (!file || !/\.csv$/i.test(file.name) || file.size > MAX_CSV_MB * 1024 * 1024) { setErr(t("fileBad", { mb: MAX_CSV_MB })); return; }
    setErr(null);
    if (!dryRun && !(await fb.confirm({ title: t("importTitle", { n: checked?.report.totalRows ?? 0 }), description: t("importBody"), confirmLabel: t("runImport"), destructive: true }))) return;
    imp.mutate({ file, country, sourceId: sourceId.trim() || undefined, dryRun }, {
      onSuccess: (r) => { if (dryRun) { setChecked({ key, report: r }); setResult(null); } else { setResult(r); setChecked(null); fb.success(t("reportReal")); } },
      onError: (x) => fb.error(problem(x as never)),
    });
  };
  const report = result ?? checked?.report;

  return (
    <div className="max-w-4xl space-y-5">
      <h1 className="text-2xl font-bold">{t("import")}</h1>
      <p className="text-sm text-muted-fg">{t("importIntro")}</p>
      <Card className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1"><Label htmlFor="imp-country">{t("country")}</Label>
            <select id="imp-country" value={country} onChange={(e) => setCountry(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"><option value="">—</option>{(countries.data ?? []).map((c) => <option key={c.iso2} value={c.iso2}>{pick(c.name, locale) || c.iso2}</option>)}</select>
          </div>
          <div className="space-y-1"><Label htmlFor="imp-source">{t("sourceId")}</Label><Input id="imp-source" value={sourceId} onChange={(e) => setSourceId(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="imp-file">{t("file")}</Label><input id="imp-file" type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" /></div>
        </div>
        <FieldError>{err}</FieldError>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void run(true)} disabled={imp.isPending}>{t("dryRun")}</Button>
          <Button onClick={() => void run(false)} disabled={imp.isPending || !canImport}><FileUp aria-hidden className="size-4" />{t("runImport")}</Button>
          {!canImport ? <span className="text-xs text-muted-fg">{t("dryRunFirst")}</span> : null}
        </div>
      </Card>
      {report ? (
        <Card className="space-y-3" aria-live="polite">
          <CardTitle>{report.dryRun ? t("report") : t("reportReal")}</CardTitle>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([["total", report.totalRows], ["accepted", report.accepted], ["flaggedN", report.flagged], ["rejectedN", report.rejected]] as const).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-muted/60 p-3"><dt className="text-xs text-muted-fg">{t(k)}</dt><dd className="text-xl font-semibold tabular">{number(v, locale)}</dd></div>
            ))}
          </dl>
          {report.errors?.length ? (
            <div className="max-h-80 overflow-auto rounded-xl border border-border" tabIndex={0} role="region" aria-label={t("message")}>
              <table className="w-full text-sm"><caption className="sr-only">{t("message")}</caption>
                <thead className="bg-muted text-muted-fg"><tr><th scope="col" className="px-3 py-2 text-start font-medium">{t("row")}</th><th scope="col" className="px-3 py-2 text-start font-medium">{t("fieldCol")}</th><th scope="col" className="px-3 py-2 text-start font-medium">{t("message")}</th></tr></thead>
                <tbody>{report.errors.map((e, i) => <tr key={i} className="border-t border-border"><th scope="row" className="px-3 py-1.5 text-start font-normal tabular">{e.row}</th><td className="px-3 py-1.5 font-mono text-xs">{e.field ?? "—"}</td><td className="px-3 py-1.5">{e.message}</td></tr>)}</tbody>
              </table>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
