"use client";
import { BadgeCheck, Eye, EyeOff, IdCard, UserRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useState } from "react";
import { EmptyState } from "@/components/agri/empty-state";
import { RangeTabs } from "@/components/agri/range-tabs";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Badge, Button, Card, FieldError, Label, Skeleton } from "@/components/ui/primitives";
import { useKycDecision, useKycQueue, type KycStatus } from "@/lib/api/admin";
import type { S } from "@/lib/api/browser";
import { relativeTime } from "@/lib/format";
import { isHttp } from "./market-common";

const STATUSES = ["pending", "verified", "rejected"] as const satisfies readonly KycStatus[];
const TONE = { pending: "forecast", verified: "up", rejected: "down" } as const;

/** /admin/kyc: seller applications. Approve to let someone sell; reject with a reason they can act on. */
export function SellerApprovals() {
  const t = useTranslations("adm");
  const [status, setStatus] = useQueryState("status", parseAsStringLiteral(STATUSES).withDefault("pending"));
  const q = useKycQueue(status);
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{t("sellerApprovals")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-fg">{t("kycIntro")}</p>
      </div>
      <RangeTabs size="sm" label={t("status")} value={status} onChange={(v) => setStatus(v === "pending" ? null : v)}
        options={STATUSES.map((s) => ({ value: s, label: t(`kyc_${s}`) }))} />
      {q.isPending ? <Skeleton className="h-72" /> : q.isError ? <EmptyState title={t("noRows")} /> : !items.length ? (
        <EmptyState icon={BadgeCheck} title={status === "pending" ? t("kycNoneWaiting") : t("noRows")} />
      ) : (
        <ul className="space-y-4">{items.map((a) => <li key={a.userId}><Application a={a} /></li>)}</ul>
      )}
      {q.hasNextPage ? <Button variant="outline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>{t("loadMore")}</Button> : null}
    </div>
  );
}

function Application({ a }: { a: S["KycApplication"] }) {
  const t = useTranslations("adm");
  const ts = useTranslations("sell");
  const locale = useLocale();
  const decide = useKycDecision();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [reveal, setReveal] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const who = a.fullName || a.displayName;
  const missingDocs = !a.idPhotoUrl || !a.selfieUrl;

  const approve = async () => {
    if (!(await fb.confirm({ title: t("kycApproveTitle", { name: who }), description: t("kycApproveBody"), confirmLabel: t("approve") }))) return;
    decide.mutate({ userId: a.userId, decision: "approve" }, { onSuccess: () => fb.success(t("kycApproved", { name: who })), onError: (x) => fb.error(problem(x as never)) });
  };
  const reject = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = reason.trim();
    if (r.length < 5) { setErr(t("kycReasonRequired")); document.getElementById(`kyc-reason-${a.userId}`)?.focus(); return; }
    setErr(null);
    if (!(await fb.confirm({ title: t("kycRejectTitle", { name: who }), description: t("kycRejectBody"), confirmLabel: t("reject"), destructive: true }))) return;
    decide.mutate({ userId: a.userId, decision: "reject", reason: r.slice(0, 500) }, { onSuccess: () => fb.success(t("kycRejected", { name: who })), onError: (x) => fb.error(problem(x as never)) });
  };

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{who}{a.fullName && a.displayName !== a.fullName ? <span className="ms-2 text-sm font-normal text-muted-fg">{a.displayName}</span> : null}</p>
          <p className="text-sm text-muted-fg">{[a.email, a.phone, a.country].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs text-muted-fg">
          <Badge tone={TONE[a.status]}>{t(`kyc_${a.status}`)}</Badge>
          {a.submittedAt ? <span>{t("kycSubmitted", { when: relativeTime(a.submittedAt, locale) })}</span> : null}
          {a.reviewedAt ? <span>{t("kycReviewed", { when: relativeTime(a.reviewedAt, locale), who: a.reviewedBy ?? "—" })}</span> : null}
        </div>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-fg">{ts("idType")}</dt><dd className="font-medium">{a.idType ? ts(`id_${a.idType}`) : "—"}</dd></div>
        <div><dt className="text-muted-fg">{ts("idNumber")}</dt>
          <dd className="flex items-center gap-2 font-mono font-medium">
            <span>{a.idNumber ? (reveal ? a.idNumber : a.idNumberMasked) : "—"}</span>
            {a.idNumber ? (
              <button type="button" onClick={() => setReveal((v) => !v)} className="rounded p-1 text-muted-fg hover:bg-muted hover:text-foreground" aria-label={reveal ? t("kycHideId") : t("kycShowId")} aria-pressed={reveal}>
                {reveal ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
              </button>
            ) : null}
          </dd>
        </div>
      </dl>

      <div className="grid gap-3 sm:grid-cols-2">
        <Doc url={a.idPhotoUrl} label={t("kycIdPhoto")} icon={IdCard} />
        <Doc url={a.selfieUrl} label={t("kycSelfie")} icon={UserRound} />
      </div>
      <p className="text-xs text-muted-fg">{t("kycLinksExpire", { min: Math.round(a.linksExpireInSeconds / 60) })}</p>
      {missingDocs && a.status === "pending" ? <p className="rounded-xl bg-info p-3 text-sm">{t("kycMissingDocs")}</p> : null}
      {a.status === "rejected" && a.rejectionReason ? <p className="rounded-xl bg-muted p-3 text-sm"><span className="font-semibold">{t("rejectReason")}:</span> {a.rejectionReason}</p> : null}

      {a.status === "pending" ? (
        rejecting ? (
          <form onSubmit={reject} noValidate className="space-y-2">
            <Label htmlFor={`kyc-reason-${a.userId}`}>{t("kycReasonLabel")}</Label>
            <textarea id={`kyc-reason-${a.userId}`} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={Boolean(err)}
              placeholder={t("kycReasonHint")} className="w-full rounded-xl border border-border bg-background p-3 text-sm" />
            <FieldError>{err}</FieldError>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="danger" disabled={decide.isPending}>{t("reject")}</Button>
              <Button type="button" variant="ghost" onClick={() => { setRejecting(false); setErr(null); }}>{t("cancel")}</Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button onClick={approve} disabled={decide.isPending || missingDocs}>{t("approve")}</Button>
            <Button variant="outline" onClick={() => setRejecting(true)} disabled={decide.isPending}>{t("reject")}</Button>
          </div>
        )
      ) : null}
    </Card>
  );
}

/** A private document behind a short-lived link. Opened in a new tab without a referrer, so the link isn't leaked. */
function Doc({ url, label, icon: Icon }: { url: string | null; label: string; icon: typeof IdCard }) {
  const t = useTranslations("adm");
  const ok = Boolean(url && isHttp(url));
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-muted/40">
      {ok ? (
        <a href={url!} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="block outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed, expiring URL from private storage: not for the image optimiser */}
          <img src={url!} alt={label} referrerPolicy="no-referrer" className="aspect-[4/3] w-full object-contain bg-background" />
        </a>
      ) : (
        <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 text-sm text-muted-fg"><Icon aria-hidden className="size-6" />{t("kycNoDoc")}</div>
      )}
      <figcaption className="px-3 py-2 text-xs font-medium">{label}</figcaption>
    </figure>
  );
}
