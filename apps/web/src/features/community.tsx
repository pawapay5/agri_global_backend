"use client";
import { Award, CheckCircle2, Flag, ImagePlus, Lightbulb, MessageCircle, Share2, ThumbsUp, Trash2, Users, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useState } from "react";
import { EmptyState } from "@/components/agri/empty-state";
import { RangeTabs } from "@/components/agri/range-tabs";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { ReportDialog } from "@/components/feedback/report-dialog";
import { Badge, Button, Card, CardTitle, FieldError, Input, Label, Skeleton } from "@/components/ui/primitives";
import { Link, useRouter } from "@/i18n/navigation";
import type { S } from "@/lib/api/browser";
import { useAcceptAnswer, useComment, useComments, useCommunityProfile, useCreatePost, useDeletePost, useFeed, useFollow, usePost, useReact, useSharePost } from "@/lib/api/community";
import { useCommodities, useMarkets, useMe } from "@/lib/api/queries";
import { absoluteTime, money, number, relativeTime, unitLabel } from "@/lib/format";
import { cn, pick } from "@/lib/utils";
import { IMAGE_ACCEPT, isHttp, MAX_UPLOAD_MB, tooBig } from "./market-common";

const TYPES = ["all", "price_update", "question", "tip", "market_news"] as const;
type PostType = S["PostType"];
const MAX_PHOTOS = 4;
const REACTIONS = [{ k: "like", icon: ThumbsUp }, { k: "helpful", icon: CheckCircle2 }, { k: "insightful", icon: Lightbulb }] as const;

/** A post needs text; a price update also needs a market and a positive price (exported for tests). */
export function postProblem(p: { type: PostType; body: string; marketId?: string; amount?: string }): "bodyRequired" | "priceRequired" | null {
  if (!p.body.trim()) return "bodyRequired";
  if (p.type === "price_update" && (!p.marketId || !(Number(p.amount) > 0))) return "priceRequired";
  return null;
}

/** /app/community (no mockup): composer and ranked feed; type and commodity filters in the URL. */
export function CommunityFeed() {
  const t = useTranslations("com");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const commodities = useCommodities(cc);
  const [f, setF] = useQueryStates({ type: parseAsStringLiteral(TYPES).withDefault("all"), commodity: parseAsString });
  const feed = useFeed(cc, { type: f.type === "all" ? undefined : f.type, commodityId: f.commodity ?? undefined });
  const posts = feed.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div><h1 className="text-2xl font-bold">{t("title")}</h1><p className="mt-1 text-sm text-muted-fg">{t("intro")}</p></div>
      <Composer cc={cc} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="max-w-full overflow-x-auto"><RangeTabs size="sm" label={t("filter")} value={f.type} onChange={(v) => void setF({ type: v === "all" ? null : v })} options={TYPES.map((x) => ({ value: x, label: x === "all" ? t("all") : t(`type_${x}`) }))} /></div>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-fg">{t("commodity")}
          <select value={f.commodity ?? ""} onChange={(e) => void setF({ commodity: e.target.value || null })} className="h-9 rounded-xl border border-border bg-background px-2 text-sm text-foreground">
            <option value="">{t("anyCommodity")}</option>{(commodities.data?.data ?? []).map((c) => <option key={c.id} value={c.id}>{pick(c.name, locale)}</option>)}
          </select>
        </label>
      </div>
      {feed.isPending ? <Skeleton className="h-96" /> : !posts.length ? <EmptyState icon={Users} title={t("empty")} /> : (
        <>
          <ul className="space-y-4">{posts.map((p) => <li key={p.id}><PostCard post={p} /></li>)}</ul>
          {feed.hasNextPage ? <Button variant="outline" onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>{t("loadMore")}</Button> : null}
        </>
      )}
    </div>
  );
}

function Composer({ cc }: { cc: string }) {
  const t = useTranslations("com");
  const locale = useLocale();
  const commodities = useCommodities(cc);
  const markets = useMarkets(cc);
  const create = useCreatePost();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [type, setType] = useState<PostType>("tip");
  const [body, setBody] = useState("");
  const [commodityId, setCommodityId] = useState("");
  const [marketId, setMarketId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [unit, setUnit] = useState("kg");
  const [photos, setPhotos] = useState<File[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const select = "h-10 w-full rounded-xl border border-border bg-background px-3 text-sm";

  const addPhotos = (files: FileList | null) => {
    const list = [...(files ?? [])];
    if (list.some(tooBig)) { setErr(t("photoTooBig", { mb: MAX_UPLOAD_MB })); return; }
    const next = [...photos, ...list].slice(0, MAX_PHOTOS);
    if (photos.length + list.length > MAX_PHOTOS) setErr(t("tooManyPhotos", { n: MAX_PHOTOS })); else setErr(null);
    setPhotos(next);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = postProblem({ type, body, marketId, amount });
    if (p) { setErr(t(p)); return; }
    setErr(null);
    const isPrice = type === "price_update";
    create.mutate({
      body: { type, body: body.trim().slice(0, 5000), ...(commodityId ? { commodityId } : {}), ...(marketId ? { marketId } : {}), ...(isPrice ? { price: { amount: amount.trim(), currency: currency.trim().toUpperCase(), unit: unit.trim() } } : {}) },
      photos,
    }, {
      onSuccess: () => { setBody(""); setAmount(""); setPhotos([]); fb.success(isPrice ? t("postedPrice") : t("posted")); },
      onError: (x) => fb.error(problem(x as never)),
    });
  };

  return (
    <Card>
      <form onSubmit={submit} noValidate className="space-y-3">
        <CardTitle className="text-base">{t("composeTitle")}</CardTitle>
        <RangeTabs size="sm" label={t("type")} value={type} onChange={setType} options={(["tip", "question", "price_update", "market_news"] as const).map((x) => ({ value: x, label: t(`type_${x}`) }))} />
        <label htmlFor="cp-body" className="sr-only">{t("body")}</label>
        <textarea id="cp-body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={5000} placeholder={t("body")} className="w-full rounded-xl border border-border bg-background p-3 text-sm" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="cp-commodity">{t("commodity")}</Label>
            <select id="cp-commodity" value={commodityId} onChange={(e) => setCommodityId(e.target.value)} className={select}><option value="">—</option>{(commodities.data?.data ?? []).map((c) => <option key={c.id} value={c.id}>{pick(c.name, locale)}</option>)}</select>
          </div>
          {type === "price_update" || type === "market_news" ? (
            <div className="space-y-1"><Label htmlFor="cp-market">{t("market")}</Label>
              <select id="cp-market" value={marketId} onChange={(e) => setMarketId(e.target.value)} className={select}><option value="">—</option>{(markets.data?.data ?? []).map((m) => <option key={m.id} value={m.id}>{pick(m.name, locale)}</option>)}</select>
            </div>
          ) : null}
        </div>
        {type === "price_update" ? (
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1"><Label htmlFor="cp-amount">{t("amount")}</Label><Input id="cp-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="cp-cur">{t("currency")}</Label><Input id="cp-cur" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="GHS" /></div>
            <div className="space-y-1"><Label htmlFor="cp-unit">{t("unit")}</Label><Input id="cp-unit" value={unit} maxLength={32} onChange={(e) => setUnit(e.target.value)} /></div>
          </div>
        ) : null}
        {photos.length ? (
          <ul className="flex flex-wrap gap-2">{photos.map((p, i) => (
            <li key={i} className="flex items-center gap-1 rounded-lg bg-muted px-2 py-1 text-xs">{p.name}<button type="button" onClick={() => setPhotos(photos.filter((_, j) => j !== i))} aria-label={`${t("delete")}: ${p.name}`}><X className="size-3" /></button></li>
          ))}</ul>
        ) : null}
        <FieldError>{err}</FieldError>
        <div className="flex items-center justify-between gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted-fg hover:bg-muted">
            <ImagePlus aria-hidden className="size-4" />{t("photos", { n: MAX_PHOTOS })}
            <input type="file" accept={IMAGE_ACCEPT} multiple className="sr-only" onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} disabled={photos.length >= MAX_PHOTOS} />
          </label>
          <Button type="submit" size="sm" disabled={create.isPending}>{t("post")}</Button>
        </div>
      </form>
    </Card>
  );
}

const PRICE_TONE = { pending: "forecast", approved: "up", flagged: "down", rejected: "neutral" } as const;

export function PostCard({ post, full = false }: { post: S["Post"]; full?: boolean }) {
  const t = useTranslations("com");
  const locale = useLocale();
  const me = useMe();
  const router = useRouter();
  const react = useReact();
  const share = useSharePost();
  const del = useDeletePost();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const mine = post.author?.id === me.data?.id;
  const price = post.price as { amount?: string; currency?: string; unit?: string } | null | undefined;
  const photos = (post.photos ?? []).filter((p) => isHttp(p.urls?.medium));

  const onShare = () => share.mutate(post.id!, {
    onSuccess: async (r) => { const url = isHttp(r.url) ? r.url : `${location.origin}/${locale}/app/community/posts/${post.id}`; try { await navigator.clipboard.writeText(url); fb.success(t("shared")); } catch { fb.error(url); } },
    onError: (x) => fb.error(problem(x as never)),
  });
  const onDelete = async () => {
    if (!(await fb.confirm({ title: t("deleteTitle"), description: t("deleteBody"), confirmLabel: t("delete"), destructive: true }))) return;
    del.mutate(post.id!, { onSuccess: () => { fb.success(t("deleted")); if (full) router.push("/app/community"); }, onError: (x) => fb.error(problem(x as never)) });
  };

  return (
    <Card className="space-y-3">
      <header className="flex items-start gap-3">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-info font-semibold text-brand">{(post.author?.name ?? "?").charAt(0).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 text-sm">
            {post.author?.id ? <Link href={`/app/community/users/${post.author.id}`} className="font-semibold hover:underline">{post.author.name || t("someone")}</Link> : <span className="font-semibold">{t("someone")}</span>}
            {post.author?.reputation != null ? <span className="text-xs text-muted-fg">{t("reputation", { n: number(post.author.reputation, locale) })}</span> : null}
            {post.author?.badges?.slice(0, 2).map((b) => <Badge key={b} tone="brand"><Award aria-hidden className="size-3" />{b}</Badge>)}
          </p>
          <p className="text-xs text-muted-fg"><Badge className="me-1.5">{t(`type_${post.type}`)}</Badge>{post.createdAt ? <time dateTime={post.createdAt} title={absoluteTime(post.createdAt, locale)}>{relativeTime(post.createdAt, locale)}</time> : null}</p>
        </div>
      </header>
      {price?.amount && price.currency ? (
        <p className="flex flex-wrap items-center gap-2"><span className="text-xl font-semibold tabular">{money(price.amount, price.currency, locale)}<span className="text-sm font-normal text-muted-fg">/{unitLabel(price.unit)}</span></span>
          {post.priceObservationStatus ? <Badge tone={PRICE_TONE[post.priceObservationStatus]}>{t(`ps_${post.priceObservationStatus}`)}</Badge> : null}</p>
      ) : null}
      <p className={cn("whitespace-pre-wrap break-words text-sm", !full && "line-clamp-6")}>{post.body}</p>
      {photos.length ? (
        <ul className="grid grid-cols-2 gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- member upload from our storage */}
          {photos.map((p) => <li key={p.id}><a href={isHttp(p.urls.large) ? p.urls.large : p.urls.medium} target="_blank" rel="noopener noreferrer"><img src={p.urls.medium} alt="" className="aspect-[4/3] w-full rounded-xl object-cover" loading="lazy" /></a></li>)}
        </ul>
      ) : null}
      <footer className="flex flex-wrap items-center gap-1 border-t border-border pt-2 text-sm">
        {REACTIONS.map(({ k, icon: Icon }) => {
          const on = post.myReaction === k;
          return (
            <button key={k} type="button" aria-pressed={on} onClick={() => react.mutate({ id: post.id!, type: on ? null : k }, { onError: (x) => fb.error(problem(x as never)) })}
              className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-muted", on ? "text-brand" : "text-muted-fg")}>
              <Icon aria-hidden className={cn("size-4", on && "fill-current/20")} />{t(`react_${k}`)}
            </button>
          );
        })}
        <span className="sr-only">{t("reactions", { n: post.counts?.reactions ?? 0 })}</span>
        <Link href={`/app/community/posts/${post.id}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-muted-fg hover:bg-muted"><MessageCircle aria-hidden className="size-4" />{t("comments", { n: post.counts?.comments ?? 0 })}</Link>
        <button type="button" onClick={onShare} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-muted-fg hover:bg-muted"><Share2 aria-hidden className="size-4" />{t("share")}</button>
        <span className="ms-auto flex items-center">
          {mine ? <button type="button" onClick={() => void onDelete()} className="rounded-lg p-2 text-down hover:bg-down/10" aria-label={t("delete")} title={t("delete")}><Trash2 className="size-4" /></button>
            : <ReportDialog targetType="post" targetId={post.id!} trigger={<button type="button" className="rounded-lg p-2 text-muted-fg hover:bg-muted" aria-label={t("report")} title={t("report")}><Flag className="size-4" /></button>} />}
        </span>
      </footer>
    </Card>
  );
}

/** /app/community/posts/[id]: the post and its threaded comments; the asker can accept an answer. */
export function PostDetail({ id }: { id: string }) {
  const t = useTranslations("com");
  const me = useMe();
  const post = usePost(id);
  const comments = useComments(id);
  if (post.isPending) return <Skeleton className="h-96" />;
  if (post.isError || !post.data) return <EmptyState title={t("empty")} />;
  const p = post.data;
  const canAccept = p.type === "question" && p.author?.id === me.data?.id;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/app/community" className="text-sm font-semibold text-brand hover:underline">← {t("back")}</Link>
      <h1 className="sr-only">{t(`type_${p.type}`)}</h1>
      <PostCard post={p} full />
      <Card className="space-y-4">
        <CommentForm postId={id} />
        {comments.isPending ? <Skeleton className="h-32" /> : !comments.data?.length ? <p className="text-sm text-muted-fg">{t("noComments")}</p> : (
          <ol className="space-y-4">{comments.data.map((c) => <li key={c.id}><CommentItem c={c} postId={id} canAccept={canAccept} acceptedId={p.acceptedCommentId} /></li>)}</ol>
        )}
      </Card>
    </div>
  );
}

function CommentForm({ postId, parentId, onDone, label }: { postId: string; parentId?: string; onDone?: () => void; label?: string }) {
  const t = useTranslations("com");
  const add = useComment(postId);
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [body, setBody] = useState("");
  const fid = `cm-${parentId ?? "root"}`;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!body.trim()) return; add.mutate({ body: body.trim().slice(0, 2000), ...(parentId ? { parentId } : {}) }, { onSuccess: () => { setBody(""); fb.success(t("commentSent")); onDone?.(); }, onError: (x) => fb.error(problem(x as never)) }); }} className="flex items-end gap-2">
      <label htmlFor={fid} className="sr-only">{label ?? t("writeComment")}</label>
      <textarea id={fid} value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={2000} placeholder={label ?? t("writeComment")} className="flex-1 rounded-xl border border-border bg-background p-3 text-sm" />
      <Button type="submit" size="sm" disabled={!body.trim() || add.isPending}>{t("send")}</Button>
    </form>
  );
}

function CommentItem({ c, postId, canAccept, acceptedId, depth = 0 }: { c: S["Comment"]; postId: string; canAccept: boolean; acceptedId?: string | null; depth?: number }) {
  const t = useTranslations("com");
  const locale = useLocale();
  const accept = useAcceptAnswer(postId);
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [replying, setReplying] = useState(false);
  // Only top-level comments answer a question; replies never carry the highlight (and stacked tints would hurt contrast).
  const isAccepted = depth === 0 && (c.accepted || c.id === acceptedId);
  const name = c.author?.name || t("someone");
  return (
    <div className={cn("space-y-2", depth > 0 && "border-s-2 border-border ps-4", isAccepted && "rounded-xl bg-up/10 p-3")}>
      {isAccepted ? <p className="flex items-center gap-1 text-xs font-semibold text-up-ink"><CheckCircle2 aria-hidden className="size-4" />{t("answer")}</p> : null}
      <p className="text-sm"><span className="font-semibold">{name}</span>{c.createdAt ? <span className="ms-2 text-xs text-muted-fg">{relativeTime(c.createdAt, locale)}</span> : null}</p>
      <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
      <div className="flex flex-wrap gap-3 text-xs">
        {depth === 0 ? <button type="button" onClick={() => setReplying((r) => !r)} aria-expanded={replying} className="font-semibold text-brand hover:underline">{t("reply")}</button> : null}
        {canAccept && !isAccepted && depth === 0 ? <button type="button" onClick={() => accept.mutate(c.id!, { onSuccess: () => fb.success(t("accepted")), onError: (x) => fb.error(problem(x as never)) })} className="font-semibold text-up-ink hover:underline">{t("accept")}</button> : null}
        <ReportDialog targetType="comment" targetId={c.id!} trigger={<button type="button" className="text-muted-fg hover:underline">{t("report")}</button>} />
      </div>
      {replying ? <CommentForm postId={postId} parentId={c.id} onDone={() => setReplying(false)} label={t("replyTo", { name })} /> : null}
      {c.replies?.length ? <ol className="space-y-3">{c.replies.map((r) => <li key={r.id}><CommentItem c={r} postId={postId} canAccept={false} depth={depth + 1} /></li>)}</ol> : null}
    </div>
  );
}

/** /app/community/users/[id]: reputation, badges and follow. */
export function CommunityProfilePage({ id }: { id: string }) {
  const t = useTranslations("com");
  const locale = useLocale();
  const me = useMe();
  const profile = useCommunityProfile(id);
  const follow = useFollow(id);
  const fb = useFeedback();
  const problem = useProblemMessage();
  if (profile.isPending) return <Skeleton className="h-64" />;
  if (profile.isError || !profile.data) return <EmptyState title={t("someone")} />;
  const p = profile.data;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/app/community" className="text-sm font-semibold text-brand hover:underline">← {t("back")}</Link>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <span aria-hidden className="grid size-14 place-items-center rounded-full bg-info text-xl font-semibold text-brand">{(p.name ?? "?").charAt(0).toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold">{p.name || t("someone")}</h1>
            <p className="text-sm capitalize text-muted-fg">{p.role} · {t("reputation", { n: number(p.reputation ?? 0, locale) })}</p>
          </div>
          {id !== me.data?.id ? (
            <Button variant={p.isFollowing ? "outline" : "primary"} size="sm" aria-pressed={Boolean(p.isFollowing)} disabled={follow.isPending}
              onClick={() => follow.mutate(!p.isFollowing, { onError: (x) => fb.error(problem(x as never)) })}>{p.isFollowing ? t("unfollow") : t("follow")}</Button>
          ) : null}
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-fg">
          <li>{t("followers", { n: p.followers ?? 0 })}</li><li>{t("following", { n: p.following ?? 0 })}</li><li>{t("posts", { n: p.posts ?? 0 })}</li><li>{t("approvedPrices", { n: p.approvedPriceReports ?? 0 })}</li>
        </ul>
        {p.badges?.length ? (
          <div><h2 className="text-sm font-semibold">{t("badges")}</h2>
            <ul className="mt-2 flex flex-wrap gap-2">{p.badges.map((b, i) => <li key={`${b.code}-${i}`}><Badge tone="brand"><Award aria-hidden className="size-3.5" />{b.name}{b.period ? ` · ${b.period}` : ""}</Badge></li>)}</ul>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
