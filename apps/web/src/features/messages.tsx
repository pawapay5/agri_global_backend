"use client";
import { ArrowLeft, Ban, Flag, ImagePlus, Loader2, MessageSquare, Send, ShieldAlert, Tag } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/agri/empty-state";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { ReportDialog } from "@/components/feedback/report-dialog";
import { Button, Card, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import type { S } from "@/lib/api/browser";
import { useBlockUser, useConversations, useMarkConversationRead, useMessages, useSendImage, useSendMessage } from "@/lib/api/market";
import { useMe } from "@/lib/api/queries";
import { absoluteTime, money, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { IMAGE_ACCEPT, isHttp, MAX_UPLOAD_MB, tooBig } from "./market-common";

type Conversation = S["Conversation"];
type Message = S["Message"];

/** The other person in a 1:1 conversation (exported for tests). */
export function otherMember(c: Pick<Conversation, "members">, meId: string | undefined) {
  return c.members?.find((m) => m.userId !== meId) ?? c.members?.[0];
}

/**
 * /app/messages and /app/messages/[id] (no mockup). Two panes on large screens, one on phones. Messages poll
 * while the tab is visible; the realtime socket is an open question (see the step report).
 */
export function Messages({ selectedId }: { selectedId?: string }) {
  const t = useTranslations("msg");
  return (
    <div className="space-y-4">
      <h1 className={cn("text-2xl font-bold", selectedId && "sr-only lg:not-sr-only")}>{t("title")}</h1>
      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <div className={cn(selectedId && "hidden lg:block")}><ConversationList selectedId={selectedId} /></div>
        <div className={cn(!selectedId && "hidden lg:block")}>
          {selectedId ? <Thread id={selectedId} /> : <Card className="grid h-full min-h-64 place-items-center text-sm text-muted-fg">{t("pick")}</Card>}
        </div>
      </div>
    </div>
  );
}

function ConversationList({ selectedId }: { selectedId?: string }) {
  const t = useTranslations("msg");
  const locale = useLocale();
  const me = useMe();
  const list = useConversations();
  const items = list.data?.pages.flatMap((p) => p.data) ?? [];
  if (list.isPending) return <Skeleton className="h-96" />;
  if (!items.length) return <EmptyState icon={MessageSquare} title={t("empty")} />;
  return (
    <Card className="p-0">
      <ul className="divide-y divide-border">
        {items.map((c) => {
          const other = otherMember(c, me.data?.id);
          const last = c.lastMessage;
          const preview = !last ? "" : last.kind === "image" ? t("image") : last.kind === "offer" ? t("offer", { qty: String(last.payload?.quantity ?? ""), price: String(last.payload?.pricePerUnit ?? "") }) : last.body ?? "";
          const on = c.id === selectedId;
          return (
            <li key={c.id}>
              <Link href={`/app/messages/${c.id}`} aria-current={on ? "page" : undefined} className={cn("flex gap-3 px-4 py-3 hover:bg-muted", on && "bg-muted")}>
                <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-info font-semibold text-brand" aria-hidden>
                  {(other?.name ?? "?").trim().charAt(0).toUpperCase() || "?"}
                  {other?.online ? <span className="absolute -bottom-0.5 -end-0.5 size-3 rounded-full border-2 border-card bg-up" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={cn("truncate", c.unread ? "font-semibold" : "font-medium")}>{other?.name ?? t("someone")}</span>
                    {c.lastMessageAt ? <time dateTime={c.lastMessageAt} className="shrink-0 text-xs text-muted-fg">{relativeTime(c.lastMessageAt, locale)}</time> : null}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={cn("truncate text-sm", c.unread ? "text-foreground" : "text-muted-fg")}>{last?.senderId === me.data?.id ? `${t("you")}: ` : ""}{preview}</span>
                    {c.unread ? <span className="ms-auto shrink-0 rounded-full bg-brand px-1.5 text-[11px] font-semibold text-brand-fg" aria-label={t("unread", { n: c.unread })}>{c.unread}</span> : null}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {list.hasNextPage ? <div className="border-t border-border p-3"><Button variant="outline" size="sm" onClick={() => void list.fetchNextPage()}>{t("olderMessages")}</Button></div> : null}
    </Card>
  );
}

type Pending = { clientId: string; body: string; failed: boolean };

function Thread({ id }: { id: string }) {
  const t = useTranslations("msg");
  const locale = useLocale();
  const me = useMe();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const convs = useConversations();
  const msgs = useMessages(id);
  const send = useSendMessage(id);
  const sendImage = useSendImage(id);
  const markRead = useMarkConversationRead();
  const block = useBlockUser();
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [blocked, setBlocked] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const conv = convs.data?.pages.flatMap((p) => p.data).find((c) => c.id === id);
  const other = conv ? otherMember(conv, me.data?.id) : undefined;
  const messages = [...(msgs.data?.pages.flatMap((p) => p.data) ?? [])].reverse(); // API: newest first
  const lastId = messages.at(-1)?.id;
  const seen = new Set(messages.map((m) => m.clientId).filter(Boolean));
  const shownPending = pending.filter((p) => !seen.has(p.clientId));

  useEffect(() => { if (lastId) markRead.mutate(id); }, [id, lastId]); // eslint-disable-line react-hooks/exhaustive-deps

  const deliver = (p: Pending) => {
    setPending((s) => s.map((x) => (x.clientId === p.clientId ? { ...x, failed: false } : x)));
    send.mutate({ kind: "text", body: p.body, clientId: p.clientId }, {
      onError: (e) => { setPending((s) => s.map((x) => (x.clientId === p.clientId ? { ...x, failed: true } : x))); fb.error(problem(e as never)); },
    });
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim().slice(0, 4000);
    if (!body) return;
    const p = { clientId: crypto.randomUUID(), body, failed: false };
    setPending((s) => [...s, p]);
    setText("");
    deliver(p);
  };
  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (tooBig(f)) { fb.error(t("imageTooBig", { mb: MAX_UPLOAD_MB })); return; }
    sendImage.mutate(f, { onError: (e) => fb.error(problem(e as never)) });
    if (fileRef.current) fileRef.current.value = "";
  };
  const toggleBlock = async () => {
    if (!other?.userId) return;
    const name = other.name ?? t("someone");
    if (!blocked && !(await fb.confirm({ title: t("blockTitle", { name }), description: t("blockBody"), confirmLabel: t("block"), destructive: true }))) return;
    block.mutate({ id: other.userId, block: !blocked }, { onSuccess: () => { setBlocked(!blocked); fb.success(t(blocked ? "unblocked" : "blocked", { name })); }, onError: (e) => fb.error(problem(e as never)) });
  };

  return (
    <Card className="flex h-[calc(100dvh-12rem)] min-h-[28rem] flex-col p-0">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link href="/app/messages" className="rounded-lg p-1.5 hover:bg-muted lg:hidden" aria-label={t("back")}><ArrowLeft className="size-5 rtl:rotate-180" /></Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{other?.name ?? t("someone")}</h2>
          <p className="text-xs text-muted-fg">
            {other?.online ? t("online") : null}
            {conv?.listingId ? <Link href={`/app/marketplace/${conv.listingId}`} className="ms-1 text-brand hover:underline">{t("openListing")}</Link> : null}
            {conv?.orderId ? <Link href={`/app/marketplace/orders/${conv.orderId}`} className="ms-1 text-brand hover:underline">{t("openOrder")}</Link> : null}
          </p>
        </div>
        {other?.userId ? (
          <>
            <ReportDialog targetType="user" targetId={other.userId} trigger={<button type="button" className="rounded-lg p-2 text-muted-fg hover:bg-muted" aria-label={t("report")} title={t("report")}><Flag className="size-4" /></button>} />
            <button type="button" onClick={() => void toggleBlock()} className="rounded-lg p-2 text-muted-fg hover:bg-muted" aria-label={blocked ? t("unblock") : t("block")} title={blocked ? t("unblock") : t("block")}><Ban className="size-4" /></button>
          </>
        ) : null}
      </header>

      <p className="flex items-start gap-2 border-b border-border bg-forecast/10 px-4 py-2 text-xs"><ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-forecast-ink" />{t("safety")}</p>

      <div className="flex flex-1 flex-col-reverse overflow-y-auto px-4 py-3" role="log" aria-live="polite" aria-label={t("title")}>
        <ol className="space-y-2">
          {msgs.hasNextPage ? <li className="text-center"><button type="button" onClick={() => void msgs.fetchNextPage()} className="text-xs font-semibold text-brand hover:underline">{t("olderMessages")}</button></li> : null}
          {msgs.isPending ? <li><Skeleton className="h-40" /></li> : !messages.length && !shownPending.length ? <li className="py-8 text-center text-sm text-muted-fg">{t("noMessages")}</li> : null}
          {messages.map((m) => <Bubble key={m.id} m={m} mine={m.senderId === me.data?.id} locale={locale} />)}
          {shownPending.map((p) => (
            <li key={p.clientId} className="flex justify-end">
              <div className={cn("max-w-[80%] rounded-2xl rounded-ee-sm px-3 py-2 text-sm", p.failed ? "border border-down bg-down/10" : "bg-brand/80 text-brand-fg")}>
                <p className="whitespace-pre-wrap break-words">{p.body}</p>
                {p.failed ? <button type="button" onClick={() => deliver(p)} className="mt-1 text-xs font-semibold text-down underline">{t("failed")}</button> : <p className="mt-0.5 text-[11px] opacity-80">{t("sending")}</p>}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <form onSubmit={submit} className="flex items-end gap-2 border-t border-border p-3">
        <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} className="sr-only" id={`img-${id}`} onChange={(e) => onFile(e.target.files?.[0])} />
        <label htmlFor={`img-${id}`} className="cursor-pointer rounded-xl p-2.5 text-muted-fg hover:bg-muted" title={t("attach")}>
          {sendImage.isPending ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}<span className="sr-only">{t("attach")}</span>
        </label>
        <label htmlFor={`txt-${id}`} className="sr-only">{t("placeholder")}</label>
        <textarea id={`txt-${id}`} value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={4000} placeholder={t("placeholder")}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm" />
        <Button type="submit" size="sm" className="h-11" disabled={!text.trim()} aria-label={t("send")}><Send className="size-4 rtl:-scale-x-100" /></Button>
      </form>
    </Card>
  );
}

function Bubble({ m, mine, locale }: { m: Message; mine: boolean; locale: string }) {
  const t = useTranslations("msg");
  const time = m.createdAt ? <time dateTime={m.createdAt} title={absoluteTime(m.createdAt, locale)} className="mt-0.5 block text-[11px] opacity-75">{new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(m.createdAt))}</time> : null;
  if (m.kind === "system") return <li className="py-1 text-center text-xs text-muted-fg">{m.body}</li>;
  const p = (m.payload ?? {}) as { url?: string; urls?: { medium?: string; large?: string }; quantity?: string; pricePerUnit?: string; currency?: string; unit?: string; listingId?: string };
  const img = p.urls?.medium ?? p.url;
  return (
    <li className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
      {m.warning ? <p className="mb-1 flex max-w-[80%] items-start gap-1.5 rounded-lg bg-down/10 px-2 py-1 text-xs text-down-ink"><ShieldAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" /><span><strong>{t("flagged")}:</strong> {m.warning}</span></p> : null}
      <div className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm", mine ? "rounded-ee-sm bg-brand text-brand-fg" : "rounded-es-sm bg-muted")}>
        {m.kind === "image" && isHttp(img) ? (
          // eslint-disable-next-line @next/next/no-img-element -- user upload from our storage, sized by the API's variant
          <a href={isHttp(p.urls?.large) ? p.urls!.large : img} target="_blank" rel="noopener noreferrer"><img src={img} alt={t("image")} className="max-h-64 rounded-lg" loading="lazy" /></a>
        ) : m.kind === "offer" ? (
          <p className="flex items-center gap-1.5 font-medium"><Tag aria-hidden className="size-4" />{t("offer", { qty: `${p.quantity ?? ""} ${p.unit ?? ""}`.trim(), price: p.currency ? money(p.pricePerUnit, p.currency, locale) : String(p.pricePerUnit ?? "") })}</p>
        ) : <p className="whitespace-pre-wrap break-words">{m.body}</p>}
        {time}
      </div>
      {!mine ? (
        <ReportDialog targetType="message" targetId={m.id!} trigger={<button type="button" className="mt-0.5 text-[11px] text-muted-fg hover:underline">{t("report")}</button>} />
      ) : null}
    </li>
  );
}
