"use client";
import { Banknote, Megaphone, ScrollText } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useState } from "react";
import { ALERT_CHANNELS } from "@/components/agri/alert-form";
import { EmptyState } from "@/components/agri/empty-state";
import { RangeTabs } from "@/components/agri/range-tabs";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Badge, Button, Card, CardTitle, FieldError, Input, Label, Skeleton } from "@/components/ui/primitives";
import type { S } from "@/lib/api/browser";
import { field, useAdminPayouts, useAuditLog, useBroadcast, useCountries, useModels, useReconciliation, useReviewPayout, type Row } from "@/lib/api/admin";
import { useCommodities, useRegions } from "@/lib/api/queries";
import { absoluteTime, money, number, pctPlain, relativeTime } from "@/lib/format";
import { pick } from "@/lib/utils";
import { CATEGORIES } from "./notifications";

const P_STATUS = ["pending_review", "processing", "failed"] as const;

/** /admin/payouts: payouts above the review threshold; approving sends money, so it's confirmed. */
export function AdminPayouts() {
  const t = useTranslations("adm");
  const locale = useLocale();
  const [f, setF] = useQueryStates({ status: parseAsStringLiteral(P_STATUS).withDefault("pending_review") });
  const list = useAdminPayouts(f.status);
  const review = useReviewPayout();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const rows = (list.data?.pages.flatMap((p) => p.data) ?? []) as Row[];
  const decide = async (r: Row, action: "approve" | "reject") => {
    const id = String(field(r, "id"));
    const amount = money(String(field(r, "amount") ?? ""), String(field(r, "currency") ?? ""), locale);
    if (action === "approve" && !(await fb.confirm({ title: t("payoutApproveTitle"), description: t("payoutApproveBody", { amount, account: String(field(r, "accountLabel") ?? "") }), confirmLabel: t("approve"), destructive: true }))) return;
    if (action === "reject" && !reason.trim()) return;
    review.mutate({ id, body: { action, ...(reason.trim() ? { reason: reason.trim().slice(0, 500) } : {}) } }, { onSuccess: () => { setRejectFor(null); setReason(""); fb.success(t(action === "approve" ? "approved" : "rejected")); }, onError: (x) => fb.error(problem(x as never)) });
  };
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t("payouts")}</h1>
      <RangeTabs size="sm" label={t("status")} value={f.status} onChange={(v) => void setF({ status: v === "pending_review" ? null : v })} options={P_STATUS.map((s) => ({ value: s, label: t(`ps_${s}`) }))} />
      {list.isPending ? <Skeleton className="h-64" /> : !rows.length ? <EmptyState icon={Banknote} title={t("nothingWaiting")} /> : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const id = String(field(r, "id"));
              const created = field<string>(r, "createdAt"), fail = field<string>(r, "failureReason");
              return (
                <li key={id} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-semibold tabular">{money(String(field(r, "amount") ?? ""), String(field(r, "currency") ?? ""), locale)}</p>
                      <p className="text-xs text-muted-fg">{t("account")}: {String(field(r, "accountLabel") ?? "—")}{created ? ` · ${t("requested")} ${relativeTime(created, locale)}` : ""}</p>
                      {fail ? <p className="text-xs text-down">{fail}</p> : null}
                    </div>
                    {f.status === "pending_review" ? (
                      <span className="flex gap-2">
                        <Button size="sm" onClick={() => void decide(r, "approve")} disabled={review.isPending}>{t("approve")}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setRejectFor(rejectFor === id ? null : id)} aria-expanded={rejectFor === id}>{t("reject")}…</Button>
                      </span>
                    ) : null}
                  </div>
                  {rejectFor === id ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-56 flex-1 space-y-1"><Label htmlFor={`pr-${id}`}>{t("rejectReason")}</Label><Input id={`pr-${id}`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></div>
                      <Button size="sm" variant="outline" className="border-down text-down" disabled={!reason.trim() || review.isPending} onClick={() => void decide(r, "reject")}>{t("reject")}</Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {list.hasNextPage ? <div className="border-t border-border p-3"><Button variant="outline" size="sm" onClick={() => void list.fetchNextPage()}>{t("loadMore")}</Button></div> : null}
        </Card>
      )}
    </div>
  );
}

/** /admin/reconciliation: daily match of our ledger against each PSP's settlement report. */
export function Reconciliation() {
  const t = useTranslations("adm");
  const locale = useLocale();
  const [f, setF] = useQueryStates({ provider: parseAsString });
  const runs = useReconciliation(f.provider ?? undefined);
  const rows = (runs.data ?? []) as Row[];
  const providers = [...new Set(rows.map((r) => String(field(r, "provider"))))];
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t("recon")}</h1>
      <label className="flex max-w-xs flex-col gap-1 text-xs font-medium text-muted-fg">{t("provider")}
        <select value={f.provider ?? ""} onChange={(e) => void setF({ provider: e.target.value || null })} className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground"><option value="">{t("allProviders")}</option>{[...new Set([...providers, ...(f.provider ? [f.provider] : [])])].map((p) => <option key={p} value={p}>{p}</option>)}</select>
      </label>
      {runs.isPending ? <Skeleton className="h-64" /> : !rows.length ? <EmptyState title={t("noRows")} /> : (
        <Card className="overflow-x-auto p-0" tabIndex={0} role="region" aria-label={t("recon")}>
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="sr-only">{t("recon")}</caption>
            <thead className="bg-muted text-muted-fg"><tr>{["day", "provider", "status", "matched", "mismatched"].map((k) => <th key={k} scope="col" className="px-3 py-2 text-start font-medium">{t(k)}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const st = String(field(r, "status"));
                return (
                  <tr key={String(field(r, "id") ?? i)} className="border-t border-border">
                    <th scope="row" className="px-3 py-2 text-start font-normal">{String(field(r, "day") ?? "").slice(0, 10)}</th>
                    <td className="px-3 py-2">{String(field(r, "provider"))}</td>
                    <td className="px-3 py-2"><Badge tone={st === "matched" ? "up" : st === "mismatched" ? "forecast" : "down"}>{t.has(`rs_${st}`) ? t(`rs_${st}`) : st}</Badge></td>
                    <td className="px-3 py-2 tabular">{number(Number(field(r, "matched") ?? 0), locale)}</td>
                    <td className="px-3 py-2 tabular">{number(Number(field(r, "mismatched") ?? 0), locale)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/** Broadcast form rules mirroring the contract (exported for tests). */
export function broadcastProblem(b: { country: string; title: string; body: string; channels: string[] }): "pickCountry" | "titleBad" | "bodyBad" | "pickChannel" | null {
  if (!/^[A-Z]{2}$/.test(b.country)) return "pickCountry";
  if (!b.title.trim() || b.title.length > 120) return "titleBad";
  if (!b.body.trim() || b.body.length > 1000) return "bodyBad";
  if (!b.channels.length) return "pickChannel";
  return null;
}

const ROLES: S["Role"][] = ["farmer", "trader", "consumer", "researcher", "student", "policymaker", "enumerator", "agronomist"];

/** /admin/broadcasts: targeted notification; sending is confirmed and can't be recalled. */
export function Broadcasts() {
  const t = useTranslations("adm");
  const td = useTranslations("dash");
  const tds = useTranslations("ds");
  const locale = useLocale();
  const countries = useCountries();
  const send = useBroadcast();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [b, setB] = useState({ country: "", roles: [] as S["Role"][], regionIds: [] as string[], commodityIds: [] as string[], category: "system" as S["NotificationCategory"], title: "", body: "", channels: ["in_app"] as S["Channel"][] });
  const regions = useRegions(b.country);
  const commodities = useCommodities(b.country);
  const [err, setErr] = useState<string | null>(null);
  const toggle = <K extends "roles" | "regionIds" | "commodityIds" | "channels">(k: K, v: (typeof b)[K][number]) => setB((s) => ({ ...s, [k]: (s[k] as string[]).includes(v as string) ? (s[k] as string[]).filter((x) => x !== v) : [...(s[k] as string[]), v] }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = broadcastProblem(b);
    if (p) { setErr(t(p)); return; }
    setErr(null);
    const countryName = pick(countries.data?.find((c) => c.iso2 === b.country)?.name, locale) || b.country;
    if (!(await fb.confirm({ title: t("sendTitle"), description: t("sendBody", { country: countryName }), confirmLabel: t("send"), destructive: true }))) return;
    send.mutate({ country: b.country, category: b.category, title: b.title.trim(), body: b.body.trim(), channels: b.channels, ...(b.roles.length ? { roles: b.roles } : {}), ...(b.regionIds.length ? { regionIds: b.regionIds } : {}), ...(b.commodityIds.length ? { commodityIds: b.commodityIds } : {}) }, {
      onSuccess: (r) => fb.success(t("sent", { n: r?.recipients ?? 0 })), onError: (x) => fb.error(problem(x as never)),
    });
  };
  const box = "max-h-40 space-y-1 overflow-y-auto rounded-xl border border-border p-2";
  return (
    <div className="max-w-4xl space-y-5">
      <h1 className="text-2xl font-bold">{t("broadcasts")}</h1>
      <p className="text-sm text-muted-fg">{t("bcIntro")}</p>
      <Card>
        <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="bc-country">{t("country")}</Label><select id="bc-country" value={b.country} onChange={(e) => setB({ ...b, country: e.target.value, regionIds: [], commodityIds: [] })} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"><option value="">—</option>{(countries.data ?? []).map((c) => <option key={c.iso2} value={c.iso2}>{pick(c.name, locale) || c.iso2}</option>)}</select></div>
            <div className="space-y-1"><Label htmlFor="bc-cat">{t("category")}</Label><select id="bc-cat" value={b.category} onChange={(e) => setB({ ...b, category: e.target.value as S["NotificationCategory"] })} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm">{CATEGORIES.map((c) => <option key={c} value={c}>{td(`cat_${c}`)}</option>)}</select></div>
          </div>
          <fieldset><legend className="text-sm font-medium">{t("audience")}</legend>
            <div className="mt-2 grid gap-4 sm:grid-cols-3">
              <fieldset className="space-y-1"><legend className="text-xs text-muted-fg">{t("roles")}</legend><div className={box}>{ROLES.map((r) => <label key={r} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={b.roles.includes(r)} onChange={() => toggle("roles", r)} className="size-4 accent-brand" />{r}</label>)}</div></fieldset>
              <fieldset className="space-y-1"><legend className="text-xs text-muted-fg">{t("regions")}</legend><div className={box}>{(regions.data ?? []).map((r) => <label key={r.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={b.regionIds.includes(r.id)} onChange={() => toggle("regionIds", r.id)} className="size-4 accent-brand" />{pick(r.name, locale)}</label>)}</div></fieldset>
              <fieldset className="space-y-1"><legend className="text-xs text-muted-fg">{t("commodities")}</legend><div className={box}>{(commodities.data?.data ?? []).map((c) => <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={b.commodityIds.includes(c.id)} onChange={() => toggle("commodityIds", c.id)} className="size-4 accent-brand" />{pick(c.name, locale)}</label>)}</div></fieldset>
            </div>
          </fieldset>
          <div className="space-y-1"><Label htmlFor="bc-title">{t("title")}</Label><Input id="bc-title" value={b.title} maxLength={120} onChange={(e) => setB({ ...b, title: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="bc-body">{t("body")}</Label><textarea id="bc-body" rows={4} maxLength={1000} value={b.body} onChange={(e) => setB({ ...b, body: e.target.value })} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /><p className="text-end text-xs text-muted-fg tabular">{b.body.length}/1000</p></div>
          <fieldset className="space-y-1"><legend className="text-sm font-medium">{t("channels")}</legend>
            <div className="flex flex-wrap gap-4">{ALERT_CHANNELS.map((c) => <label key={c} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={b.channels.includes(c)} onChange={() => toggle("channels", c)} className="size-4 accent-brand" />{tds(`ch_${c}`)}</label>)}</div>
          </fieldset>
          <FieldError>{err}</FieldError>
          <Button type="submit" disabled={send.isPending}><Megaphone aria-hidden className="size-4" />{t("send")}</Button>
        </form>
      </Card>
    </div>
  );
}

/** /admin/models: model versions, hardest series, forecast confidence mix and pipeline status. */
export function ModelsDashboard() {
  const t = useTranslations("adm");
  const locale = useLocale();
  const models = useModels();
  if (models.isPending) return <Skeleton className="h-96" />;
  const m = (models.data ?? {}) as { versions?: Row[]; worstSeries?: Row[]; confidenceDistribution?: Row[]; pipelines?: Row[] };
  const table = (title: string, rows: Row[] | undefined, cols: [string, string, (v: unknown, r: Row) => React.ReactNode][]) => (
    <Card className="space-y-3 p-0">
      <CardTitle className="px-5 pt-5">{title}</CardTitle>
      {!rows?.length ? <p className="px-5 pb-5 text-sm text-muted-fg">{t("noRows")}</p> : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={title}>
          <table className="w-full min-w-[36rem] text-sm"><caption className="sr-only">{title}</caption>
            <thead className="bg-muted text-muted-fg"><tr>{cols.map(([k, label]) => <th key={k} scope="col" className="px-3 py-2 text-start font-medium">{label}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-border">{cols.map(([k, , fmt], j) => j === 0 ? <th key={k} scope="row" className="px-3 py-2 text-start font-medium">{fmt(field(r, k), r)}</th> : <td key={k} className="px-3 py-2">{fmt(field(r, k), r)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
  const txt = (v: unknown) => (v == null ? "—" : String(v));
  const when = (v: unknown) => (typeof v === "string" ? <time dateTime={v} title={absoluteTime(v, locale)}>{relativeTime(v, locale)}</time> : "—");
  const pctv = (v: unknown) => (v == null ? "—" : pctPlain(Number(v), locale));
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("models")}</h1>
      {table(t("versions"), m.versions, [["name", t("name"), (v, r) => `${txt(v)} v${txt(field(r, "version"))}`], ["algorithm", t("algorithm"), txt], ["status", t("status"), (v) => <Badge tone={v === "production" ? "up" : "neutral"}>{txt(v)}</Badge>], ["trainedAt", t("trained"), when], ["metrics", t("metrics"), (v) => <code className="font-mono text-xs">{v ? JSON.stringify(v).slice(0, 80) : "—"}</code>]])}
      {table(t("worst"), m.worstSeries, [["commodity", t("commodity"), txt], ["horizonMonths", t("horizon"), txt], ["mape", t("mape"), pctv], ["coverageP10P90", t("coverage"), pctv], ["nFolds", t("folds"), txt]])}
      {table(t("confidence"), m.confidenceDistribution, [["horizonMonths", t("horizon"), txt], ["confidence", t("status"), txt], ["n", "n", (v) => number(Number(v ?? 0), locale)]])}
      {table(t("pipelines"), m.pipelines, [["flow", t("flow"), txt], ["countryIso2", t("country"), txt], ["status", t("status"), (v) => <Badge tone={v === "failed" ? "down" : v === "running" ? "forecast" : "up"}>{txt(v)}</Badge>], ["startedAt", t("started"), when], ["finishedAt", t("finished"), when], ["error", t("error"), (v) => (v ? <span className="text-xs text-down">{String(v).slice(0, 120)}</span> : "—")]])}
    </div>
  );
}

/** /admin/audit: who did what, filterable; entries expand to their data. */
export function AuditLog() {
  const t = useTranslations("adm");
  const locale = useLocale();
  const [f, setF] = useQueryStates({ actor: parseAsString, action: parseAsString, entity: parseAsString, from: parseAsString });
  const [draft, setDraft] = useState({ actor: f.actor ?? "", action: f.action ?? "", entity: f.entity ?? "", from: f.from ?? "" });
  const log = useAuditLog({ actorId: f.actor && /^[0-9a-f-]{36}$/i.test(f.actor) ? f.actor : undefined, action: f.action ?? undefined, entity: f.entity ?? undefined, from: f.from ? new Date(f.from).toISOString() : undefined });
  const rows = (log.data?.pages.flatMap((p) => p.data) ?? []) as Row[];
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t("audit")}</h1>
      <Card>
        <form onSubmit={(e) => { e.preventDefault(); void setF({ actor: draft.actor.trim() || null, action: draft.action.trim() || null, entity: draft.entity.trim() || null, from: draft.from || null }); }} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <div className="space-y-1"><Label htmlFor="au-actor">{t("actor")}</Label><Input id="au-actor" value={draft.actor} onChange={(e) => setDraft({ ...draft, actor: e.target.value })} className="font-mono text-xs" /></div>
          <div className="space-y-1"><Label htmlFor="au-action">{t("action")}</Label><Input id="au-action" value={draft.action} maxLength={80} onChange={(e) => setDraft({ ...draft, action: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="au-entity">{t("entity")}</Label><Input id="au-entity" value={draft.entity} maxLength={40} onChange={(e) => setDraft({ ...draft, entity: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="au-from">{t("from")}</Label><Input id="au-from" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></div>
          <div className="flex gap-2"><Button type="submit" size="sm">{t("filter")}</Button><Button type="button" variant="ghost" size="sm" onClick={() => { setDraft({ actor: "", action: "", entity: "", from: "" }); void setF({ actor: null, action: null, entity: null, from: null }); }}>{t("clear")}</Button></div>
        </form>
      </Card>
      {log.isPending ? <Skeleton className="h-96" /> : !rows.length ? <EmptyState icon={ScrollText} title={t("noRows")} /> : (
        <Card className="p-0">
          <ul className="divide-y divide-border text-sm">
            {rows.map((e, i) => {
              const id = String(field(e, "id") ?? i);
              const at = field<string>(e, "at");
              return (
                <li key={id}>
                  <button type="button" onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-start hover:bg-muted">
                    <code className="font-mono text-xs font-semibold">{String(field(e, "action"))}</code>
                    <span className="text-xs text-muted-fg">{String(field(e, "entity") ?? "")}{field(e, "entityId") ? ` · ${String(field(e, "entityId")).slice(0, 8)}` : ""}</span>
                    <span className="ms-auto text-xs text-muted-fg">{at ? <time dateTime={at} title={absoluteTime(at, locale)}>{relativeTime(at, locale)}</time> : ""}</span>
                  </button>
                  {open === id ? (
                    <dl className="grid gap-1 bg-muted/40 px-4 py-3 text-xs sm:grid-cols-[8rem_1fr]">
                      <dt className="text-muted-fg">{t("actor")}</dt><dd className="font-mono">{String(field(e, "actorId") ?? "—")}</dd>
                      <dt className="text-muted-fg">{t("ip")}</dt><dd className="font-mono">{String(field(e, "ip") ?? "—")}</dd>
                      <dt className="text-muted-fg">{t("data")}</dt><dd><pre className="max-h-60 overflow-auto whitespace-pre-wrap">{JSON.stringify(field(e, "data") ?? {}, null, 2)}</pre></dd>
                    </dl>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {log.hasNextPage ? <div className="border-t border-border p-3"><Button variant="outline" size="sm" onClick={() => void log.fetchNextPage()}>{t("loadMore")}</Button></div> : null}
        </Card>
      )}
    </div>
  );
}
