"use client";
import { Gavel, ShieldAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useState } from "react";
import { EmptyState } from "@/components/agri/empty-state";
import { RangeTabs } from "@/components/agri/range-tabs";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Badge, Button, Card, FieldError, Input, Label, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import type { S } from "@/lib/api/browser";
import { field, type Row } from "@/lib/api/admin";
import { useAdminDisputes, useDisputeDecision, useModerationDecision, useModerationQueue } from "@/lib/api/market";
import { money, relativeTime } from "@/lib/format";
import { orderRef } from "./market-common";

const TARGETS = ["all", "listing", "message", "post", "comment", "user", "price"] as const;
const ACTIONS = ["none", "hide", "remove", "warn_user", "suspend_user"] as const;
const UUID = /^[0-9a-f-]{36}$/i;

/** Where a reported item can be seen in context, when it has a page (exported for tests). */
export function moderationHref(r: { targetType?: string; targetId?: string }): string | null {
  const id = UUID.test(r.targetId ?? "") ? r.targetId : null;
  if (!id) return null;
  if (r.targetType === "listing") return `/app/marketplace/${id}`;
  if (r.targetType === "post") return `/app/community/posts/${id}`;
  if (r.targetType === "user") return `/app/community/users/${id}`;
  return null;
}

/** /admin/moderation: open reports, one decision per item; every decision is audited server-side. */
export function ModerationQueue() {
  const t = useTranslations("mod");
  const ta = useTranslations("adm");
  const tr = useTranslations("rpt");
  const locale = useLocale();
  const [type, setType] = useQueryState("type", parseAsStringLiteral(TARGETS).withDefault("all"));
  const queue = useModerationQueue(type === "all" ? undefined : type);
  const rows = (queue.data?.pages.flatMap((p) => p.data) ?? []) as Row[];
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t("queue")}</h1>
      <div className="overflow-x-auto"><RangeTabs size="sm" label={t("target")} value={type} onChange={(v) => setType(v === "all" ? null : v)} options={TARGETS.map((x) => ({ value: x, label: x === "all" ? t("all") : t(`t_${x}`) }))} /></div>
      {queue.isPending ? <Skeleton className="h-72" /> : !rows.length ? <EmptyState icon={ShieldAlert} title={t("empty")} /> : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const id = String(field(r, "id"));
            const targetType = field<string>(r, "targetType"), targetId = field<string>(r, "targetId");
            const reason = field<string>(r, "reason"), details = field<string>(r, "details"), created = field<string>(r, "createdAt");
            const count = field<number>(r, "openReports") ?? field<number>(r, "reportCount");
            const href = moderationHref({ targetType, targetId });
            return (
              <li key={id}><Card className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{targetType && t.has(`t_${targetType}`) ? t(`t_${targetType}`) : targetType}</Badge>
                  {count ? <Badge tone="down">{t("reports", { n: count })}</Badge> : null}
                  {reason ? <Badge tone="forecast">{tr.has(`reason_${reason}`) ? tr(`reason_${reason}`) : reason}</Badge> : null}
                  {created ? <span className="text-xs text-muted-fg">{relativeTime(created, locale)}</span> : null}
                  {href ? <Link href={href} className="ms-auto text-sm font-semibold text-brand hover:underline" target="_blank" rel="noopener">{ta("open")}</Link> : null}
                </div>
                {details ? <blockquote className="whitespace-pre-wrap rounded-xl bg-muted p-3 text-sm">{details}</blockquote> : null}
                <Decision id={id} />
              </Card></li>
            );
          })}
        </ul>
      )}
      {queue.hasNextPage ? <Button variant="outline" onClick={() => void queue.fetchNextPage()}>{ta("loadMore")}</Button> : null}
    </div>
  );
}

function Decision({ id }: { id: string }) {
  const t = useTranslations("mod");
  const fb = useFeedback();
  const problem = useProblemMessage();
  const decide = useModerationDecision();
  const [action, setAction] = useState<(typeof ACTIONS)[number]>("hide");
  const [note, setNote] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (action === "suspend_user" && !(await fb.confirm({ title: t("suspendTitle"), description: t("suspendBody"), confirmLabel: t("a_suspend_user"), destructive: true }))) return;
    decide.mutate({ id, body: { action, ...(note.trim() ? { note: note.trim().slice(0, 500) } : {}) } }, { onSuccess: () => fb.success(t("done")), onError: (x) => fb.error(problem(x as never)) });
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
      <div className="space-y-1"><Label htmlFor={`md-a-${id}`}>{t("decide")}</Label>
        <select id={`md-a-${id}`} value={action} onChange={(e) => setAction(e.target.value as typeof action)} className="h-10 rounded-xl border border-border bg-background px-3 text-sm">
          {ACTIONS.map((a) => <option key={a} value={a}>{t(`a_${a}`)}</option>)}
        </select>
      </div>
      <div className="min-w-48 flex-1 space-y-1"><Label htmlFor={`md-n-${id}`}>{t("note")}</Label><Input id={`md-n-${id}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></div>
      <Button type="submit" size="sm" disabled={decide.isPending}>{t("apply")}</Button>
    </form>
  );
}

const D_STATUS = ["open", "under_review", "resolved"] as const;

/** Refund must be a positive amount no larger than the order total (exported for tests). */
export function refundProblem(amount: string, total: number): boolean {
  const n = Number(amount);
  return !amount.trim() || !Number.isFinite(n) || n <= 0 || n > total;
}

/** /admin/disputes: list by status; resolve with release, refund or split (money moves, so it's confirmed). */
export function AdminDisputes() {
  const t = useTranslations("mod");
  const tm = useTranslations("mp");
  const ta = useTranslations("adm");
  const locale = useLocale();
  const [status, setStatus] = useQueryState("status", parseAsStringLiteral(D_STATUS).withDefault("open"));
  const list = useAdminDisputes(status);
  const rows = (list.data?.pages.flatMap((p) => p.data) ?? []) as Row[];
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t("disputesTitle")}</h1>
      <RangeTabs size="sm" label={t("disputesTitle")} value={status} onChange={(v) => setStatus(v === "open" ? null : v)} options={[{ value: "open", label: t("open") }, { value: "under_review", label: t("underReview") }, { value: "resolved", label: t("resolved") }]} />
      {list.isPending ? <Skeleton className="h-72" /> : !rows.length ? <EmptyState icon={Gavel} title={t("noDisputes")} /> : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const d = { id: String(field(r, "id")), orderId: field<string>(r, "orderId"), reason: field<string>(r, "reason"), total: field<string>(r, "total"), currency: field<string>(r, "currency"), description: field<string>(r, "description"), createdAt: field<string>(r, "createdAt") };
            return (
              <li key={d.id}><Card className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {d.orderId ? <Link href={`/app/marketplace/orders/${d.orderId}`} className="font-semibold text-brand hover:underline" target="_blank" rel="noopener">{tm("order", { ref: orderRef(d.orderId) })}</Link> : null}
                  {d.reason ? <Badge tone="down">{tm.has(`dr_${d.reason}`) ? tm(`dr_${d.reason}`) : d.reason}</Badge> : null}
                  {d.total && d.currency ? <span className="text-sm tabular">{money(d.total, d.currency, locale)}</span> : null}
                  {d.createdAt ? <span className="ms-auto text-xs text-muted-fg">{relativeTime(d.createdAt, locale)}</span> : null}
                </div>
                {d.description ? <p className="whitespace-pre-wrap rounded-xl bg-muted p-3 text-sm">{d.description}</p> : null}
                <Link href={`/app/disputes/${d.id}`} className="text-sm font-semibold text-brand hover:underline" target="_blank" rel="noopener">{tm("viewDispute")}</Link>
                {status !== "resolved" ? <Resolve d={d} /> : null}
              </Card></li>
            );
          })}
        </ul>
      )}
      {list.hasNextPage ? <Button variant="outline" onClick={() => void list.fetchNextPage()}>{ta("loadMore")}</Button> : null}
    </div>
  );
}

function Resolve({ d }: { d: { id: string; total?: string; currency?: string } }) {
  const t = useTranslations("mod");
  const fb = useFeedback();
  const problem = useProblemMessage();
  const decide = useDisputeDecision(d.id);
  const [outcome, setOutcome] = useState<S["DisputeDecision"]["outcome"]>("refund_buyer");
  const [refund, setRefund] = useState("");
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const total = Number(d.total ?? 0) || 0;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (outcome === "split" && refundProblem(refund, total)) { setBad(true); return; }
    setBad(false);
    if (!(await fb.confirm({ title: t("resolveTitle"), description: t("resolveBody"), confirmLabel: t("resolve"), destructive: true }))) return;
    decide.mutate({ outcome, ...(outcome === "split" ? { refundAmount: refund.trim() } : {}), ...(note.trim() ? { note: note.trim().slice(0, 2000) } : {}) }, { onSuccess: () => fb.success(t("resolvedToast")), onError: (x) => fb.error(problem(x as never)) });
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3 border-t border-border pt-3">
      <fieldset className="flex flex-wrap gap-4"><legend className="mb-1 text-sm font-medium">{t("outcome")}</legend>
        {(["release_seller", "refund_buyer", "split"] as const).map((o) => <label key={o} className="flex items-center gap-1.5 text-sm"><input type="radio" name={`out-${d.id}`} checked={outcome === o} onChange={() => setOutcome(o)} className="size-4 accent-brand" />{t(`o_${o}`)}</label>)}
      </fieldset>
      {outcome === "split" ? (
        <div className="max-w-xs space-y-1"><Label htmlFor={`rf-${d.id}`}>{t("refundAmount")} ({d.currency})</Label><Input id={`rf-${d.id}`} inputMode="decimal" value={refund} onChange={(e) => setRefund(e.target.value)} aria-invalid={bad} /><FieldError>{bad ? t("amountBad") : null}</FieldError></div>
      ) : null}
      <div className="space-y-1"><Label htmlFor={`dn-${d.id}`}>{t("note")}</Label><textarea id={`dn-${d.id}`} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></div>
      <Button type="submit" size="sm" disabled={decide.isPending}>{t("resolve")}</Button>
    </form>
  );
}
