"use client";
import { AlertCircle, CheckCircle2, Copy, Download, FileText, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { EmptyState } from "@/components/agri/empty-state";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Badge, Button, Card, CardTitle, FieldError, Input, Label, Skeleton } from "@/components/ui/primitives";
import { ApiError, type S } from "@/lib/api/browser";
import { useCommodities, useCreateReport, useMarkets, useMe, useReportJobs, useSubscription } from "@/lib/api/queries";
import { absoluteTime, relativeTime } from "@/lib/format";
import { cn, pick } from "@/lib/utils";
import { PageTitle, UpgradePrompt } from "./common";

const TYPES = ["crop_price", "market_analysis", "forecast", "regional", "custom"] as const;
const FORMATS = ["pdf", "xlsx", "csv"] as const;
const SECTIONS = ["summary", "history", "comparison", "regional", "seasonal", "forecast", "explanations"] as const;
const MAX_COMMODITIES = 20, MAX_MARKETS = 30;

type Draft = { type: (typeof TYPES)[number]; format: (typeof FORMATS)[number]; commodityIds: string[]; marketIds: string[]; from: string; to: string; sections: string[] };
export type DraftErrors = Partial<Record<"commodityIds" | "marketIds" | "dates" | "sections", string>>;

/** Local calendar day as YYYY-MM-DD. */
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Client-side checks mirroring the contract's limits; returns message keys per field (exported for tests). */
export function validateReport(d: Pick<Draft, "type" | "commodityIds" | "marketIds" | "from" | "to" | "sections">, today: string): DraftErrors {
  const e: DraftErrors = {};
  if (!d.commodityIds.length) e.commodityIds = "pickCommodities";
  else if (d.commodityIds.length > MAX_COMMODITIES) e.commodityIds = "tooMany";
  if (d.marketIds.length > MAX_MARKETS) e.marketIds = "tooMany";
  if (!d.from || !d.to || d.from > d.to || d.to > today) e.dates = "badRange";
  if (d.type === "custom" && !d.sections.length) e.sections = "pickSections";
  return e;
}

const fileSize = (bytes: number, locale: string) => {
  const units = ["byte", "kilobyte", "megabyte"] as const;
  let v = bytes, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return new Intl.NumberFormat(locale, { style: "unit", unit: units[i], unitDisplay: "short", maximumFractionDigits: i ? 1 : 0 }).format(v);
};

/** /app/reports (mockup: Reports). Queue a report, then follow its status; downloads are signed links from the API. */
export function ReportsPage() {
  const t = useTranslations("rep");
  return (
    <div className="space-y-6">
      <PageTitle title={t("title")} subtitle={t("intro")} />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="h-fit lg:col-span-2"><CardTitle>{t("newReport")}</CardTitle><ReportForm /></Card>
        <div className="lg:col-span-3"><Jobs /></div>
      </div>
    </div>
  );
}

function ReportForm() {
  const t = useTranslations("rep");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const commodities = useCommodities(cc);
  const markets = useMarkets(cc);
  const sub = useSubscription();
  const create = useCreateReport();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [today] = useState(() => isoDay(new Date()));
  const [d, setD] = useState<Draft>(() => ({ type: "crop_price", format: "pdf", commodityIds: [], marketIds: [], from: isoDay(new Date(Date.now() - 90 * 86_400_000)), to: today, sections: ["summary", "history"] }));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [locked, setLocked] = useState<string | null>(null);
  const allowedFormats = sub.data?.entitlements?.report_formats;
  const perMonth = sub.data?.entitlements?.reports_per_month;
  const toggle = (k: "commodityIds" | "marketIds" | "sections", id: string) => setD((s) => ({ ...s, [k]: s[k].includes(id) ? s[k].filter((x) => x !== id) : [...s[k], id] }));
  const err = (k: keyof DraftErrors) => (errors[k] ? t(errors[k]!, { n: k === "marketIds" ? MAX_MARKETS : MAX_COMMODITIES }) : null);

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const e = validateReport(d, today);
    setErrors(e);
    const first = (["commodityIds", "marketIds", "dates", "sections"] as const).find((k) => e[k]);
    if (first) { document.getElementById(`rf-${first}`)?.focus(); return; }
    const body: S["ReportCreate"] = {
      type: d.type, format: d.format, country: cc, from: d.from, to: d.to, priceType: "wholesale",
      commodityIds: d.commodityIds, ...(d.marketIds.length ? { marketIds: d.marketIds } : {}), ...(d.type === "custom" ? { sections: d.sections as S["ReportCreate"]["sections"] } : {}),
    };
    create.mutate(body, {
      onSuccess: () => { setLocked(null); fb.success(t("queued")); },
      onError: (x) => (x instanceof ApiError && x.status === 402 ? setLocked(x.detail ?? "") : fb.error(problem(x as never))),
    });
  };
  const box = "max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border p-2";

  return (
    <form onSubmit={submit} noValidate className="mt-4 space-y-4">
      {locked != null ? <UpgradePrompt detail={locked || undefined} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="rf-type">{t("type")}</Label>
          <select id="rf-type" value={d.type} onChange={(e) => setD((s) => ({ ...s, type: e.target.value as Draft["type"] }))} className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm">
            {TYPES.map((x) => <option key={x} value={x}>{t(`type_${x}`)}</option>)}
          </select>
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">{t("format")}</legend>
          <div className="flex flex-wrap gap-3 pt-2">
            {FORMATS.map((f) => {
              const off = Boolean(allowedFormats && !allowedFormats.includes(f));
              return (
                <label key={f} className={cn("flex items-center gap-1.5 text-sm", off && "text-muted-fg")} title={off ? t("notInPlan") : undefined}>
                  <input type="radio" name="rf-format" value={f} checked={d.format === f} disabled={off} onChange={() => setD((s) => ({ ...s, format: f }))} className="size-4 accent-brand" />
                  {t(`format_${f}`)}{off ? <span className="sr-only"> ({t("notInPlan")})</span> : null}
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      <fieldset className="space-y-1.5" aria-describedby={errors.commodityIds ? "rf-commodityIds-err" : undefined}>
        <legend className="text-sm font-medium">{t("commodities")} ({d.commodityIds.length})</legend>
        <div id="rf-commodityIds" tabIndex={-1} className={box}>
          {commodities.isPending ? <Skeleton className="h-24" /> : (commodities.data?.data ?? []).map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.commodityIds.includes(c.id)} onChange={() => toggle("commodityIds", c.id)} className="size-4 accent-brand" />{pick(c.name, locale)}</label>
          ))}
        </div>
        <FieldError><span id="rf-commodityIds-err">{err("commodityIds")}</span></FieldError>
      </fieldset>

      <fieldset className="space-y-1.5" aria-describedby={errors.marketIds ? "rf-marketIds-err" : undefined}>
        <legend className="text-sm font-medium">{t("marketsOptional")} ({d.marketIds.length})</legend>
        <div id="rf-marketIds" tabIndex={-1} className={box}>
          {(markets.data?.data ?? []).map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.marketIds.includes(m.id)} onChange={() => toggle("marketIds", m.id)} className="size-4 accent-brand" />{pick(m.name, locale)}</label>
          ))}
        </div>
        <FieldError><span id="rf-marketIds-err">{err("marketIds")}</span></FieldError>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2" aria-describedby={errors.dates ? "rf-dates-err" : undefined}>
        <div className="space-y-1.5"><Label htmlFor="rf-dates">{t("from")}</Label><Input id="rf-dates" type="date" value={d.from} max={d.to || today} onChange={(e) => setD((s) => ({ ...s, from: e.target.value }))} aria-invalid={!!errors.dates} suppressHydrationWarning /></div>
        <div className="space-y-1.5"><Label htmlFor="rf-to">{t("to")}</Label><Input id="rf-to" type="date" value={d.to} min={d.from} max={today} onChange={(e) => setD((s) => ({ ...s, to: e.target.value }))} aria-invalid={!!errors.dates} suppressHydrationWarning /></div>
      </div>
      <FieldError><span id="rf-dates-err">{err("dates")}</span></FieldError>

      {d.type === "custom" ? (
        <fieldset className="space-y-1.5" aria-describedby={errors.sections ? "rf-sections-err" : undefined}>
          <legend className="text-sm font-medium">{t("sections")}</legend>
          <div id="rf-sections" tabIndex={-1} className="grid grid-cols-2 gap-1.5">
            {SECTIONS.map((x) => <label key={x} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.sections.includes(x)} onChange={() => toggle("sections", x)} className="size-4 accent-brand" />{t(`section_${x}`)}</label>)}
          </div>
          <FieldError><span id="rf-sections-err">{err("sections")}</span></FieldError>
        </fieldset>
      ) : null}

      {perMonth != null ? <p className="text-xs text-muted-fg">{t("perMonth", { n: perMonth })}</p> : null}
      <Button type="submit" className="w-full" disabled={create.isPending || !cc}>{create.isPending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <FileText aria-hidden className="size-4" />}{t("create")}</Button>
    </form>
  );
}

/** Only http(s) links from the API become clickable (never javascript: or data:). */
const isHttp = (u: string | null | undefined): u is string => typeof u === "string" && /^https?:\/\//i.test(u);

const STATUS = { queued: { tone: "neutral", icon: Loader2, spin: true }, running: { tone: "forecast", icon: Loader2, spin: true }, succeeded: { tone: "up", icon: CheckCircle2, spin: false }, failed: { tone: "down", icon: AlertCircle, spin: false } } as const;

function Jobs() {
  const t = useTranslations("rep");
  const ta = useTranslations("app");
  const locale = useLocale();
  const jobs = useReportJobs();
  const fb = useFeedback();
  const [now] = useState(() => Date.now());
  const items = jobs.data?.pages.flatMap((p) => p.data) ?? [];
  const copy = async (url: string) => { try { await navigator.clipboard.writeText(url); fb.success(t("copied")); } catch { fb.error(url); } };

  return (
    <Card className="space-y-3">
      <CardTitle>{t("jobs")}</CardTitle>
      {jobs.isPending ? <Skeleton className="h-48" /> : jobs.isError ? (
        <p role="alert" className="text-sm">{ta("error")} <button onClick={() => jobs.refetch()} className="ms-2 font-semibold text-brand hover:underline">↻</button></p>
      ) : !items.length ? <EmptyState icon={FileText} title={t("noJobs")} /> : (
        <>
          <ul className="divide-y divide-border" aria-live="polite">
            {items.map((j) => {
              const s = STATUS[j.status];
              const expired = j.downloadUrlExpiresAt ? new Date(j.downloadUrlExpiresAt).getTime() < now : false;
              const typeLabel = t.has(`type_${j.type}`) ? t(`type_${j.type}`) : j.type;
              return (
                <li key={j.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{typeLabel} <span className="font-normal text-muted-fg">· {j.format.toUpperCase()}</span></p>
                    <p className="text-xs text-muted-fg">
                      <time dateTime={j.createdAt} title={absoluteTime(j.createdAt, locale)}>{t("created", { time: relativeTime(j.createdAt, locale) })}</time>
                      {j.bytes ? ` · ${fileSize(j.bytes, locale)}` : ""}
                      {j.status === "succeeded" && j.downloadUrlExpiresAt ? ` · ${expired ? t("expired") : t("expires", { time: relativeTime(j.downloadUrlExpiresAt, locale) })}` : ""}
                    </p>
                    {j.status === "failed" && j.error ? <p className="text-xs text-down">{j.error}</p> : null}
                  </div>
                  <Badge tone={s.tone}><s.icon aria-hidden className={cn("size-3.5", s.spin && "animate-spin")} />{t(`status_${j.status}`)}</Badge>
                  {j.status === "succeeded" && isHttp(j.downloadUrl) && !expired ? (
                    <span className="flex gap-1">
                      <a href={j.downloadUrl} rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-semibold text-brand hover:bg-muted"><Download aria-hidden className="size-4" />{t("download")}</a>
                      {isHttp(j.shortUrl) ? <button type="button" onClick={() => void copy(j.shortUrl!)} aria-label={`${t("copyLink")}: ${typeLabel}`} title={t("copyLink")} className="rounded-lg p-2 hover:bg-muted"><Copy className="size-4" /></button> : null}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {jobs.hasNextPage ? <Button variant="outline" size="sm" onClick={() => void jobs.fetchNextPage()} disabled={jobs.isFetchingNextPage}>{t("loadMore")}</Button> : null}
        </>
      )}
    </Card>
  );
}
