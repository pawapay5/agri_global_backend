"use client";
import { AlertTriangle, Check, ClipboardCheck, FileUp, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useState } from "react";
import { EmptyState } from "@/components/agri/empty-state";
import { RangeTabs } from "@/components/agri/range-tabs";
import { StatCard } from "@/components/agri/stat-card";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Badge, Button, Card, CardTitle, FieldError, Input, Label, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import type { S } from "@/lib/api/browser";
import { field, useAuditLog, useCountries, useImportPrices, useModels, useReviewPrice, useReviewQueue, type Row } from "@/lib/api/admin";
import { useModerationQueue } from "@/lib/api/market";
import { money, number, relativeTime, unitLabel } from "@/lib/format";
import { pick } from "@/lib/utils";

/**
 * /admin: what's waiting, pipeline health, latest models, recent audit entries. Queue counts are the size of the
 * first page with "+" when there are more (the API has no totals), never an estimate.
 */
export function AdminOverview() {
  const t = useTranslations("adm");
  const locale = useLocale();
  const review = useReviewQueue(undefined, "pending");
  const flagged = useReviewQueue(undefined, "flagged");
  const mod = useModerationQueue();
  const models = useModels();
  const audit = useAuditLog({}, 8);
  const count = (q: { data?: { pages: { data: unknown[]; nextCursor?: string | null }[] }; isPending: boolean; isError: boolean }) => {
    if (q.isPending) return "…";
    if (q.isError || !q.data) return "—";
    const p = q.data.pages[0]!;
    return p.data.length ? t("waiting", { n: p.data.length, more: String(Boolean(p.nextCursor)) }) : t("nothingWaiting");
  };
  const m = models.data as { versions?: Row[]; pipelines?: Row[] } | undefined;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("overview")}</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/admin/prices/review" className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"><StatCard label={t("review")} value={count(review)} /></Link>
        <Link href="/admin/prices/review?status=flagged" className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"><StatCard label={`${t("review")} · ${t("st_flagged")}`} value={count(flagged)} /></Link>
        <Link href="/admin/moderation" className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"><StatCard label={t("moderation")} value={count(mod)} /></Link>
      </div>
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
