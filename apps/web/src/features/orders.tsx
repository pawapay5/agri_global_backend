"use client";
import { AlertTriangle, Clock, CreditCard, FileUp, Loader2, MessageSquare, Package, Smartphone } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useState } from "react";
import { EmptyState } from "@/components/agri/empty-state";
import { RangeTabs } from "@/components/agri/range-tabs";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Button, Card, CardTitle, FieldError, Input, Label, Skeleton } from "@/components/ui/primitives";
import { Link, useRouter } from "@/i18n/navigation";
import type { S } from "@/lib/api/browser";
import { useAddEvidence, useDispute, useOrder, useOrders, useOrderTransition, usePayOrder, useReviewOrder, useStartConversation } from "@/lib/api/market";
import { useMe } from "@/lib/api/queries";
import { absoluteTime, money, number, relativeTime, unitLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isHttp, isTrustedPaymentUrl, MAX_UPLOAD_MB, normaliseMsisdn, OrderStatusBadge, orderRef, tooBig } from "./market-common";
import { configuredProviders } from "./billing";

type Action = NonNullable<S["OrderTransition"]["action"]>;
const CONFIRM: Partial<Record<Action, true>> = { confirm: true, cancel: true, collect_cash: true };
const ROLES = ["buyer", "seller"] as const;
// Order payments use the first configured web provider that also collects marketplace payments.
const PAY_PROVIDER = configuredProviders().find((p): p is "paystack" | "flutterwave" => p === "paystack" || p === "flutterwave") ?? "paystack";

/** /app/marketplace/orders and the seller centre's orders tab: one list, the role picks the side. */
export function OrdersList({ fixedRole }: { fixedRole?: "buyer" | "seller" }) {
  const t = useTranslations("mp");
  const locale = useLocale();
  const [roleParam, setRole] = useQueryState("role", parseAsStringLiteral(ROLES).withDefault("buyer"));
  const role = fixedRole ?? roleParam;
  const orders = useOrders(role);
  const items = orders.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("orders")}</h1>
        {!fixedRole ? <RangeTabs size="sm" label={t("orders")} value={role} onChange={(v) => setRole(v === "buyer" ? null : v)} options={[{ value: "buyer", label: t("buying") }, { value: "seller", label: t("selling") }]} /> : null}
      </div>
      {orders.isPending ? <Skeleton className="h-64" /> : !items.length ? <EmptyState icon={Package} title={t("noOrders")} /> : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {items.map((o) => (
              <li key={o.id}>
                <Link href={`/app/marketplace/orders/${o.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{t("order", { ref: orderRef(o.id!) })}</span>
                    <span className="text-xs text-muted-fg">{o.createdAt ? relativeTime(o.createdAt, locale) : ""}{o.items?.length ? ` · ${o.items.length} × ` : ""}</span>
                  </span>
                  <OrderStatusBadge status={o.status!} />
                  <span className="w-28 text-end font-semibold tabular">{money(o.total, o.currency ?? "", locale)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {orders.hasNextPage ? <div className="border-t border-border p-3"><Button variant="outline" size="sm" onClick={() => void orders.fetchNextPage()}>{t("loadMore")}</Button></div> : null}
        </Card>
      )}
    </div>
  );
}

/** /app/marketplace/orders/[id]: summary, the actions the API allows now, payment, timeline, review. */
export function OrderDetail({ id }: { id: string }) {
  const t = useTranslations("mp");
  const locale = useLocale();
  const router = useRouter();
  const me = useMe();
  const order = useOrder(id);
  const move = useOrderTransition(id);
  const chat = useStartConversation();
  const fb = useFeedback();
  const problem = useProblemMessage();
  if (order.isPending) return <Skeleton className="h-96" />;
  if (order.isError || !order.data) return <EmptyState icon={Package} title={t("noOrders")} />;
  const o = order.data;
  const isBuyer = o.buyerId === me.data?.id;
  const actions = (o.allowedActions ?? []) as Action[];
  const cur = o.currency ?? "";

  const run = async (a: Action) => {
    if (CONFIRM[a] && !(await fb.confirm({ title: t(`confirmTitle_${a}`), description: t(`confirmBody_${a}`), confirmLabel: t(`act_${a}`), destructive: a === "cancel" }))) return;
    move.mutate({ action: a }, { onSuccess: () => fb.success(t("updated")), onError: (e) => fb.error(problem(e as never)) });
  };
  const message = () => chat.mutate({ userId: (isBuyer ? o.sellerId : o.buyerId)!, orderId: o.id }, { onSuccess: (c) => router.push(`/app/messages/${c.id}`), onError: (e) => fb.error(problem(e as never)) });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{t("order", { ref: orderRef(o.id!) })}</h1>
        <OrderStatusBadge status={o.status!} />
        {o.stateDeadlineAt ? <span className="flex items-center gap-1 text-xs text-muted-fg"><Clock aria-hidden className="size-3.5" /><time dateTime={o.stateDeadlineAt} title={absoluteTime(o.stateDeadlineAt, locale)}>{t("deadline", { time: relativeTime(o.stateDeadlineAt, locale) })}</time></span> : null}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="space-y-3">
            <CardTitle className="text-base">{t("items")}</CardTitle>
            <ul className="divide-y divide-border text-sm">
              {(o.items ?? []).map((raw, i) => {
                const it = raw as { listingId?: string; title?: string; quantity?: string; unit?: string; pricePerUnit?: string; lineTotal?: string };
                return (
                  <li key={i} className="flex items-center justify-between gap-3 py-2">
                    <span>{it.listingId ? <Link href={`/app/marketplace/${it.listingId}`} className="hover:text-brand hover:underline">{it.title || it.listingId}</Link> : it.title}<span className="block text-xs text-muted-fg">{number(Number(it.quantity), locale)} {unitLabel(it.unit)} × {money(it.pricePerUnit, cur, locale)}</span></span>
                    <span className="tabular">{money(it.lineTotal, cur, locale)}</span>
                  </li>
                );
              })}
            </ul>
            <dl className="space-y-1 border-t border-border pt-3 text-sm">
              <div className="flex justify-between"><dt className="text-muted-fg">{t("subtotal")}</dt><dd className="tabular">{money(o.subtotal, cur, locale)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-fg">{t("delivery")}{o.deliveryOption && t.has(`delivery_${o.deliveryOption}`) ? ` (${t(`delivery_${o.deliveryOption}`)})` : ""}</dt><dd className="tabular">{money(o.deliveryFee, cur, locale)}</dd></div>
              {!isBuyer && o.commission ? <div className="flex justify-between"><dt className="text-muted-fg">{t("commission")}</dt><dd className="tabular">−{money(o.commission, cur, locale)}</dd></div> : null}
              <div className="flex justify-between text-base font-semibold"><dt>{t("total")}</dt><dd className="tabular">{money(o.total, cur, locale)}</dd></div>
            </dl>
          </Card>
          <Card className="space-y-3">
            <CardTitle className="text-base">{t("timeline")}</CardTitle>
            <ol className="space-y-2 border-s-2 border-border ps-4 text-sm">
              {[...(o.events ?? [])].map((raw, i) => {
                const ev = raw as { type?: string; status?: string; at?: string; createdAt?: string; note?: string };
                const at = ev.at ?? ev.createdAt;
                const st = (ev.status ?? ev.type) as S["OrderStatus"] | undefined;
                return <li key={i}><p className="font-medium">{st && t.has(`status_${st}`) ? t(`status_${st}`) : ev.type}</p>{at ? <time dateTime={at} className="text-xs text-muted-fg">{absoluteTime(at, locale)}</time> : null}{ev.note ? <p className="text-muted-fg">{ev.note}</p> : null}</li>;
              })}
            </ol>
          </Card>
        </div>
        <div className="space-y-4">
          {isBuyer && o.status === "pending_payment" && o.paymentMethod !== "pay_on_delivery" ? <PayPanel order={o} /> : null}
          {actions.length || o.disputeId ? (
            <Card className="space-y-2">
              {actions.filter((a) => a !== "dispute").map((a) => (
                <Button key={a} className="w-full" variant={a === "cancel" ? "outline" : "primary"} onClick={() => void run(a)} disabled={move.isPending}>{t(`act_${a}`)}</Button>
              ))}
              {actions.includes("dispute") ? <DisputeDialog orderId={o.id!} /> : null}
              {o.disputeId ? <Link href={`/app/disputes/${o.disputeId}`} className="flex items-center gap-1.5 text-sm font-semibold text-down hover:underline"><AlertTriangle aria-hidden className="size-4" />{t("viewDispute")}</Link> : null}
            </Card>
          ) : null}
          <Button variant="outline" className="w-full" onClick={message} disabled={chat.isPending}><MessageSquare aria-hidden className="size-4" />{isBuyer ? t("messageSeller") : t("messageBuyer")}</Button>
          {isBuyer && o.status === "completed" ? <ReviewForm orderId={o.id!} /> : null}
        </div>
      </div>
    </div>
  );
}

function PayPanel({ order }: { order: S["Order"] }) {
  const t = useTranslations("mp");
  const locale = useLocale();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const pay = usePayOrder(order.id!);
  const [method, setMethod] = useState<"momo" | "card">(order.paymentMethod === "card" ? "card" : "momo");
  const [network, setNetwork] = useState<"mtn" | "telecel" | "airteltigo">("mtn");
  const [msisdn, setMsisdn] = useState("");
  const [bad, setBad] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = method === "momo" ? normaliseMsisdn(msisdn) : null;
    if (method === "momo" && !n) { setBad(true); document.getElementById("pay-msisdn")?.focus(); return; }
    setBad(false);
    pay.mutate({ provider: PAY_PROVIDER, method, ...(method === "momo" ? { network, msisdn: n! } : {}) }, {
      onSuccess: (r) => {
        if (r.status === "failed") { fb.error(t("payFailed")); return; }
        if (r.authorizationUrl) {
          if (!isTrustedPaymentUrl(r.authorizationUrl)) { fb.error(t("payUntrusted")); return; }
          setPrompt(t("payRedirect")); window.location.assign(r.authorizationUrl); return;
        }
        setPrompt(r.displayText ?? t("payPrompt")); // the order view polls until the webhook confirms payment
      },
      onError: (x) => fb.error(problem(x as never)),
    });
  };

  return (
    <Card className="space-y-3">
      <CardTitle className="text-base">{t("pay")}</CardTitle>
      {prompt ? <p role="status" className="flex items-start gap-2 rounded-xl bg-info p-3 text-sm"><Loader2 aria-hidden className="mt-0.5 size-4 shrink-0 animate-spin" />{prompt}</p> : (
        <form onSubmit={submit} noValidate className="space-y-3">
          <fieldset className="flex gap-4">
            <legend className="sr-only">{t("payWith")}</legend>
            <label className="flex items-center gap-1.5 text-sm"><input type="radio" checked={method === "momo"} onChange={() => setMethod("momo")} className="size-4 accent-brand" /><Smartphone aria-hidden className="size-4" />{t("pay_momo")}</label>
            <label className="flex items-center gap-1.5 text-sm"><input type="radio" checked={method === "card"} onChange={() => setMethod("card")} className="size-4 accent-brand" /><CreditCard aria-hidden className="size-4" />{t("pay_card")}</label>
          </fieldset>
          {method === "momo" ? (
            <>
              <div className="space-y-1"><Label htmlFor="pay-net">{t("network")}</Label>
                <select id="pay-net" value={network} onChange={(e) => setNetwork(e.target.value as typeof network)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm">
                  {(["mtn", "telecel", "airteltigo"] as const).map((n) => <option key={n} value={n}>{t(`net_${n}`)}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label htmlFor="pay-msisdn">{t("msisdn")}</Label>
                <Input id="pay-msisdn" type="tel" inputMode="tel" autoComplete="tel" value={msisdn} onChange={(e) => setMsisdn(e.target.value)} aria-invalid={bad} aria-describedby="pay-msisdn-hint" />
                <p id="pay-msisdn-hint" className="text-xs text-muted-fg">{t("msisdnHint")}</p>
                <FieldError>{bad ? t("msisdnBad") : null}</FieldError>
              </div>
            </>
          ) : null}
          <Button type="submit" className="w-full" disabled={pay.isPending}>{pay.isPending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}{t("pay")} · {money(order.total, order.currency ?? "", locale)}</Button>
        </form>
      )}
    </Card>
  );
}

const DISPUTE_REASONS = ["not_received", "not_as_described", "damaged", "wrong_quantity", "other"] as const;
function DisputeDialog({ orderId }: { orderId: string }) {
  const t = useTranslations("mp");
  const tr = useTranslations("rpt");
  const fb = useFeedback();
  const problem = useProblemMessage();
  const move = useOrderTransition(orderId);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof DISPUTE_REASONS)[number]>("not_received");
  const [details, setDetails] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    move.mutate({ action: "dispute", disputeReason: reason, ...(details.trim() ? { reason: details.trim().slice(0, 1000) } : {}) }, {
      onSuccess: () => { setOpen(false); fb.success(t("disputeOpened")); }, onError: (x) => fb.error(problem(x as never)),
    });
  };
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild><Button variant="outline" className="w-full border-down text-down"><AlertTriangle aria-hidden className="size-4" />{t("act_dispute")}</Button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed start-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-5 shadow-xl rtl:translate-x-1/2">
          <Dialog.Title className="text-lg font-semibold">{t("disputeTitle")}</Dialog.Title>
          <Dialog.Description className="sr-only">{t("disputeReason")}</Dialog.Description>
          <form onSubmit={submit} className="mt-3 space-y-3">
            <fieldset className="space-y-1.5"><legend className="text-sm font-medium">{t("disputeReason")}</legend>
              {DISPUTE_REASONS.map((r) => <label key={r} className="flex items-center gap-2 text-sm"><input type="radio" name="dr" checked={reason === r} onChange={() => setReason(r)} className="size-4 accent-brand" />{t(`dr_${r}`)}</label>)}
            </fieldset>
            <div className="space-y-1"><Label htmlFor="dr-details">{t("disputeDetails")}</Label><textarea id="dr-details" rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></div>
            <div className="flex justify-end gap-2"><Dialog.Close asChild><Button type="button" variant="ghost" size="sm">{tr("cancel")}</Button></Dialog.Close><Button type="submit" size="sm" disabled={move.isPending}>{t("disputeOpen")}</Button></div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ReviewForm({ orderId }: { orderId: string }) {
  const t = useTranslations("mp");
  const fb = useFeedback();
  const problem = useProblemMessage();
  const review = useReviewOrder(orderId);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);
  if (done) return <Card className="text-sm">{t("reviewed")}</Card>;
  return (
    <Card className="space-y-3">
      <CardTitle className="text-base">{t("review")}</CardTitle>
      <fieldset className="flex gap-1"><legend className="sr-only">{t("review")}</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer"><input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} className="peer sr-only" />
            <span className={cn("block rounded p-0.5 peer-focus-visible:ring-2 peer-focus-visible:ring-ring", n <= rating ? "text-forecast" : "text-muted-fg")} aria-hidden>★</span><span className="sr-only">{t("stars", { n })}</span>
          </label>
        ))}
      </fieldset>
      <div className="space-y-1"><Label htmlFor="rv-comment">{t("reviewComment")}</Label><textarea id="rv-comment" rows={3} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></div>
      <Button size="sm" disabled={!rating || review.isPending} onClick={() => review.mutate({ rating, ...(comment.trim() ? { comment: comment.trim() } : {}) }, { onSuccess: () => { setDone(true); fb.success(t("reviewed")); }, onError: (e) => fb.error(problem(e as never)) })}>{t("reviewSend")}</Button>
    </Card>
  );
}

/** /app/disputes/[id]: both sides add notes and files; the admin decision appears when made. */
export function DisputeView({ id }: { id: string }) {
  const t = useTranslations("disp");
  const tm = useTranslations("mp");
  const locale = useLocale();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const dispute = useDispute(id);
  const add = useAddEvidence(id);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | undefined>();
  const [err, setErr] = useState<string | null>(null);
  if (dispute.isPending) return <Skeleton className="h-96" />;
  if (dispute.isError || !dispute.data) return <EmptyState title={t("title")} />;
  const d = dispute.data;
  const resolved = d.status === "resolved";
  const outcome = (d.resolution as { outcome?: string; note?: string } | null)?.outcome;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim() && !file) { setErr(t("needOne")); return; }
    if (file && tooBig(file)) { setErr(t("fileTooBig", { mb: MAX_UPLOAD_MB })); return; }
    setErr(null);
    add.mutate({ note: note.trim() || undefined, file }, { onSuccess: () => { setNote(""); setFile(undefined); fb.success(t("added")); }, onError: (x) => fb.error(problem(x as never)) });
  };

  return (
    <div className="max-w-3xl space-y-5">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <Card className="space-y-2 text-sm">
        <p>{t("intro")}</p>
        <dl className="grid gap-2 sm:grid-cols-3">
          <div><dt className="text-muted-fg">{t("order")}</dt><dd><Link href={`/app/marketplace/orders/${d.orderId}`} className="font-semibold text-brand hover:underline">{orderRef(d.orderId!)}</Link></dd></div>
          <div><dt className="text-muted-fg">{t("reason")}</dt><dd className="font-medium">{d.reason && tm.has(`dr_${d.reason}`) ? tm(`dr_${d.reason}`) : d.reason}</dd></div>
          <div><dt className="text-muted-fg">{t("status")}</dt><dd className="font-medium">{d.status && t.has(`st_${d.status}`) ? t(`st_${d.status}`) : d.status}</dd></div>
        </dl>
        {d.description ? <p className="whitespace-pre-wrap rounded-xl bg-muted p-3">{d.description}</p> : null}
        {resolved && outcome ? <p className="rounded-xl bg-up/10 p-3 font-medium">{t("resolution")}: {t.has(`out_${outcome}`) ? t(`out_${outcome}`) : outcome}</p> : null}
      </Card>
      <Card className="space-y-3">
        <CardTitle className="text-base">{t("evidence")}</CardTitle>
        {!d.evidence?.length ? <p className="text-sm text-muted-fg">{t("noEvidence")}</p> : (
          <ol className="space-y-3 text-sm">
            {d.evidence.map((ev) => (
              <li key={ev.id} className="rounded-xl border border-border p-3">
                {ev.note ? <p className="whitespace-pre-wrap">{ev.note}</p> : null}
                {isHttp(ev.url) ? <a href={ev.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 font-semibold text-brand hover:underline"><FileUp aria-hidden className="size-4" />{t("file")}</a> : null}
                {ev.createdAt ? <p className="mt-1 text-xs text-muted-fg">{relativeTime(ev.createdAt, locale)}</p> : null}
              </li>
            ))}
          </ol>
        )}
        {!resolved ? (
          <form onSubmit={submit} className="space-y-2 border-t border-border pt-3">
            <div className="space-y-1"><Label htmlFor="ev-note">{t("note")}</Label><textarea id="ev-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></div>
            <div className="space-y-1"><Label htmlFor="ev-file">{t("file")}</Label><input id="ev-file" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0])} className="block text-sm" /></div>
            <FieldError>{err}</FieldError>
            <Button type="submit" size="sm" disabled={add.isPending}>{t("add")}</Button>
          </form>
        ) : null}
      </Card>
    </div>
  );
}

