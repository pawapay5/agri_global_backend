"use client";
import { BadgeCheck, BarChart3, Check, Clock, Package, Plus, ShieldCheck, Store, Tag, UserRound, Wallet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useState } from "react";
import { EmptyState } from "@/components/agri/empty-state";
import { RangeTabs } from "@/components/agri/range-tabs";
import { StatCard } from "@/components/agri/stat-card";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Badge, Button, buttonVariants, Card, CardTitle, FieldError, Input, Label, Skeleton } from "@/components/ui/primitives";
import { Link, usePathname } from "@/i18n/navigation";
import { ApiError, type S } from "@/lib/api/browser";
import { useMyListings, useOffers, useRespondOffer, useSaveSellerProfile, useSellerProfile, useSellerSummary, useSubmitKyc, useWallet } from "@/lib/api/market";
import { useMe, useRegions } from "@/lib/api/queries";
import { money, number, relativeTime, unitLabel } from "@/lib/format";
import { cn, pick } from "@/lib/utils";
import { sellerStatus, type SellerStatus } from "@/components/shell/app-nav";
import { IMAGE_ACCEPT, isHttp, MAX_UPLOAD_MB, tooBig } from "./market-common";

const SECTIONS = [
  { href: "/app/sell", key: "overview", icon: Store },
  { href: "/app/sell/listings", key: "listings", icon: Package },
  { href: "/app/sell/offers", key: "offers", icon: Tag },
  { href: "/app/sell/orders", key: "orders", icon: Package },
  { href: "/app/sell/wallet", key: "wallet", icon: Wallet },
  { href: "/app/sell/analytics", key: "analytics", icon: BarChart3 },
  { href: "/app/sell/profile", key: "profile", icon: UserRound },
] as const;

export function SellerNav() {
  const t = useTranslations("sell");
  const path = usePathname();
  const profile = useSellerProfile();
  // Until the application is approved there's nothing to navigate: the overview is the application.
  if (sellerStatus(profile.data) !== "verified") return null;
  return (
    <nav aria-label={t("nav")} className="-mx-1 mb-6 overflow-x-auto px-1">
      <ul className="inline-flex gap-1 rounded-xl bg-muted p-1">
        {SECTIONS.map(({ href, key, icon: Icon }) => {
          const on = href === "/app/sell" ? path === href : path === href || path.startsWith(`${href}/`);
          return (
            <li key={key}><Link href={href} aria-current={on ? "page" : undefined} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium", on ? "bg-card shadow-sm" : "text-muted-fg hover:text-foreground")}><Icon aria-hidden className="size-4" />{t(key)}</Link></li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Pages open to everyone in the seller area: the application (overview) and the shop details it needs. */
const OPEN_PATHS = new Set(["/app/sell", "/app/sell/profile"]);
/** Whether a seller-centre page is usable yet (exported for tests). The API enforces the same rule on listings. */
export const sellerPageOpen = (path: string, status: SellerStatus) => status === "verified" || OPEN_PATHS.has(path);

/** Wraps every seller-centre page: listings, offers, orders, wallet and analytics wait until the seller is approved. */
export function SellerGate({ children }: { children: React.ReactNode }) {
  const t = useTranslations("sell");
  const path = usePathname();
  const profile = useSellerProfile();
  if (OPEN_PATHS.has(path)) return <>{children}</>;
  if (profile.isPending) return <Skeleton className="h-72" />;
  const status = sellerStatus(profile.data);
  if (sellerPageOpen(path, status)) return <>{children}</>;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <EmptyState icon={ShieldCheck} title={t("lockedTitle")} description={status === "pending" ? t("lockedPending") : t("lockedBody")}
        action={<Link href="/app/sell" className={buttonVariants()}>{status === "pending" ? t("viewApplication") : t("becomeSeller")}</Link>} />
    </div>
  );
}

const noProfile = (e: unknown) => e instanceof ApiError && e.status === 404;
const KYC_TONE = { none: "neutral", pending: "forecast", verified: "up", rejected: "down" } as const;

/** /app/sell: the seller application until approved; then KPIs, wallet and what needs attention. */
export function SellerOverview() {
  const t = useTranslations("sell");
  const profile = useSellerProfile();
  if (profile.isPending) return <Skeleton className="h-72" />;
  if (profile.error && !noProfile(profile.error)) return <EmptyState icon={Store} title={t("loadFailed")} />;
  if (sellerStatus(profile.data) !== "verified") return <SellerApplication />;
  return <SellerDashboard />;
}

function SellerDashboard() {
  const t = useTranslations("sell");
  const locale = useLocale();
  const p = useSellerProfile().data;
  const summary = useSellerSummary("30d");
  const wallet = useWallet();
  const offers = useOffers("seller", "open");
  const s = summary.data;
  const w = wallet.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">{p?.displayName ?? t("title")}<BadgeCheck aria-label={t("kyc_verified")} className="size-5 text-brand" /></h1>
          <p className="mt-1 text-sm text-muted-fg">{t("intro")}</p>
        </div>
        <Link href="/app/sell/listings/new" className={buttonVariants()}><Plus aria-hidden className="size-4" />{t("newListing")}</Link>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("revenue")} value={s ? money(s.revenue?.value, s.currency ?? "", locale) : "—"} delta={s?.revenue?.changePct != null ? { value: s.revenue.changePct, period: t("vsPrevious") } : undefined} />
        <StatCard label={t("ordersPlaced")} value={s ? number(s.ordersPlaced?.value, locale) : "—"} delta={s?.ordersPlaced?.changePct != null ? { value: s.ordersPlaced.changePct, period: t("vsPrevious") } : undefined} />
        <StatCard label={t("available")} value={w ? money(w.available, w.currency ?? "", locale) : "—"} footer={w ? <span className="text-xs text-muted-fg">{t("inEscrow")}: {money(w.inEscrow, w.currency ?? "", locale)}</span> : undefined} />
        <StatCard label={t("offers")} value={offers.data ? number(offers.data.length, locale) : "—"} footer={<Link href="/app/sell/offers" className="text-xs font-semibold text-brand hover:underline">{t("offers")} →</Link>} />
      </div>
    </div>
  );
}

/** Everyone buys; selling needs an approved application: shop details, then an ID check that an admin reviews. */
function SellerApplication() {
  const t = useTranslations("sell");
  const locale = useLocale();
  const p = useSellerProfile().data;
  const status = sellerStatus(p);
  const steps = [
    { key: "stepShop", done: Boolean(p) },
    { key: "stepId", done: status === "pending" || status === "verified" },
    { key: "stepReview", done: status === "verified" },
  ] as const;
  const current = steps.findIndex((s) => !s.done);
  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("becomeSeller")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-fg">{t("applyIntro")}</p>
      </div>
      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.key} aria-current={i === current ? "step" : undefined}
            className={cn("flex items-center gap-3 rounded-2xl border p-4 text-sm", s.done ? "border-brand/40 bg-brand/5" : i === current ? "border-brand" : "border-border")}>
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold", s.done ? "bg-brand text-brand-fg" : "bg-muted")}>
              {s.done ? <Check aria-hidden className="size-4" /> : i + 1}
            </span>
            <span><span className="block font-semibold">{t(s.key)}</span><span className="text-muted-fg">{s.done ? t("stepDone") : i === current ? t("stepNow") : t("stepLater")}</span></span>
          </li>
        ))}
      </ol>
      {status === "pending" ? (
        <Card className="flex items-start gap-3 bg-info text-sm" role="status">
          <Clock aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div><p className="font-semibold">{t("pendingTitle")}</p>
            <p className="text-muted-fg">{p?.kycSubmittedAt ? t("pendingBodyWhen", { when: relativeTime(p.kycSubmittedAt, locale) }) : t("pendingBody")}</p></div>
        </Card>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <ShopDetailsCard />
        <IdCheckCard />
      </div>
    </div>
  );
}

const ID_TYPES = ["national_id", "passport", "voter_id", "drivers_licence"] as const;

/** /app/sell/profile: shop details and the ID check. ID documents are private: only reviewers see them. */
export function SellerProfilePage() {
  const profile = useSellerProfile();
  if (profile.isPending) return <Skeleton className="h-96" />;
  return <div className="grid max-w-5xl gap-6 lg:grid-cols-2"><ShopDetailsCard /><IdCheckCard /></div>;
}

function ShopDetailsCard() {
  const t = useTranslations("sell");
  const locale = useLocale();
  const me = useMe();
  const regions = useRegions(me.data?.country ?? "");
  const p = useSellerProfile().data;
  const save = useSaveSellerProfile();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [name, setName] = useState<string | null>(null);
  const [bio, setBio] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [nameErr, setNameErr] = useState(false);
  const v = { name: name ?? p?.displayName ?? "", bio: bio ?? p?.bio ?? "", region: region ?? p?.regionId ?? "" };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (v.name.trim().length < 2 || v.name.trim().length > 80) { setNameErr(true); document.getElementById("sp-name")?.focus(); return; }
    setNameErr(false);
    save.mutate({ displayName: v.name.trim(), ...(v.bio.trim() ? { bio: v.bio.trim().slice(0, 1000) } : {}), ...(v.region ? { regionId: v.region } : {}) }, { onSuccess: () => fb.success(t("profileSaved")), onError: (x) => fb.error(problem(x as never)) });
  };
  return (
    <Card className="space-y-4">
      <CardTitle>{t("profile")}</CardTitle>
      <form onSubmit={submit} noValidate className="space-y-3">
        <div className="space-y-1"><Label htmlFor="sp-name">{t("displayName")}</Label><Input id="sp-name" value={v.name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-invalid={nameErr} required /><FieldError>{nameErr ? t("required") : null}</FieldError></div>
        <div className="space-y-1"><Label htmlFor="sp-bio">{t("bio")}</Label><textarea id="sp-bio" rows={4} maxLength={1000} value={v.bio} onChange={(e) => setBio(e.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></div>
        <div className="space-y-1"><Label htmlFor="sp-region">{t("region")}</Label>
          <select id="sp-region" value={v.region} onChange={(e) => setRegion(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm">
            <option value="">—</option>{(regions.data ?? []).map((r) => <option key={r.id} value={r.id}>{pick(r.name, locale)}</option>)}
          </select>
        </div>
        <Button type="submit" disabled={save.isPending}>{p ? t("saveProfile") : t("saveAndContinue")}</Button>
      </form>
    </Card>
  );
}

function IdCheckCard() {
  const t = useTranslations("sell");
  const p = useSellerProfile().data;
  const kyc = useSubmitKyc();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [idType, setIdType] = useState<(typeof ID_TYPES)[number]>("national_id");
  const [idNumber, setIdNumber] = useState("");
  const [idPhoto, setIdPhoto] = useState<File | undefined>();
  const [selfie, setSelfie] = useState<File | undefined>();
  const [err, setErr] = useState<string | null>(null);
  const status = sellerStatus(p);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = idNumber.trim();
    if (!n || !idPhoto || !selfie) { setErr(t("kycAllRequired")); return; }
    if (!/^[A-Z0-9-]{5,40}$/i.test(n)) { setErr(t("idNumberInvalid")); document.getElementById("kyc-num")?.focus(); return; }
    if (tooBig(idPhoto) || tooBig(selfie)) { setErr(t("fileTooBig", { mb: MAX_UPLOAD_MB })); return; }
    setErr(null);
    kyc.mutate({ idType, idNumber: n, idPhoto, selfie }, { onSuccess: () => { setIdNumber(""); setIdPhoto(undefined); setSelfie(undefined); fb.success(t("kycSent")); }, onError: (x) => fb.error(problem(x as never)) });
  };
  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between gap-3"><CardTitle>{t("kyc")}</CardTitle><Badge tone={KYC_TONE[status]}>{t(`kyc_${status}`)}</Badge></div>
      <p className="text-sm text-muted-fg">{t("kycPrivacy")}</p>
      {status === "rejected" && p?.kycRejectionReason ? (
        <div role="alert" className="rounded-xl border border-down/40 bg-down/10 p-3 text-sm"><p className="font-semibold">{t("rejectedTitle")}</p><p>{p.kycRejectionReason}</p></div>
      ) : null}
      {!p ? <p className="text-sm text-muted-fg">{t("shopFirst")}</p>
        : status === "none" || status === "rejected" ? (
          <form onSubmit={submit} noValidate className="space-y-3">
            <div className="space-y-1"><Label htmlFor="kyc-type">{t("idType")}</Label>
              <select id="kyc-type" value={idType} onChange={(e) => setIdType(e.target.value as (typeof ID_TYPES)[number])} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm">
                {ID_TYPES.map((x) => <option key={x} value={x}>{t(`id_${x}`)}</option>)}
              </select>
            </div>
            <div className="space-y-1"><Label htmlFor="kyc-num">{t("idNumber")}</Label><Input id="kyc-num" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} autoComplete="off" maxLength={40} /></div>
            <div className="space-y-1"><Label htmlFor="kyc-id">{t("idPhoto")}</Label><input id="kyc-id" type="file" accept={IMAGE_ACCEPT} capture="environment" onChange={(e) => setIdPhoto(e.target.files?.[0])} className="block text-sm" /><p className="text-xs text-muted-fg">{t("idPhotoHint")}</p></div>
            <div className="space-y-1"><Label htmlFor="kyc-selfie">{t("selfie")}</Label><input id="kyc-selfie" type="file" accept={IMAGE_ACCEPT} capture="user" onChange={(e) => setSelfie(e.target.files?.[0])} className="block text-sm" /></div>
            <FieldError>{err}</FieldError>
            <Button type="submit" disabled={kyc.isPending}>{status === "rejected" ? t("resubmitKyc") : t("submitKyc")}</Button>
          </form>
        ) : status === "pending" ? <p className="text-sm">{t("pendingBody")}</p>
        : <p className="flex items-center gap-2 text-sm font-medium"><BadgeCheck aria-hidden className="size-4 text-brand" />{t("approvedBody")}</p>}
    </Card>
  );
}

const LISTING_ST = ["all", "active", "draft", "low_stock", "sold_out"] as const;

/** /app/sell/listings: my listings by status. */
export function SellerListings() {
  const t = useTranslations("sell");
  const tm = useTranslations("mp");
  const locale = useLocale();
  const [st, setSt] = useQueryState("status", parseAsStringLiteral(LISTING_ST).withDefault("all"));
  const list = useMyListings(st === "all" ? undefined : st);
  const items = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("listings")}</h1>
        <Link href="/app/sell/listings/new" className={buttonVariants({ size: "sm" })}><Plus aria-hidden className="size-4" />{t("newListing")}</Link>
      </div>
      <RangeTabs size="sm" label={t("listings")} value={st} onChange={(v) => setSt(v === "all" ? null : v)} options={LISTING_ST.map((s) => ({ value: s, label: s === "all" ? t("st_all") : s === "active" ? t("st_active") : tm(`status_${s}`) }))} />
      {list.isPending ? <Skeleton className="h-64" /> : !items.length ? <EmptyState icon={Package} title={t("noListings")} /> : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {items.map((l) => {
              const photo = l.photos?.[0]?.urls?.thumb ?? l.photos?.[0]?.urls?.medium;
              return (
                <li key={l.id}>
                  <Link href={`/app/sell/listings/${l.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted">
                    <span className="size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element -- seller upload from our storage */}
                      {isHttp(photo) ? <img src={photo} alt="" className="size-full object-cover" /> : null}
                    </span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{l.title}</span><span className="text-xs text-muted-fg">{number(Number(l.quantity), locale)} {unitLabel(l.unit)} · {l.createdAt ? relativeTime(l.createdAt, locale) : ""}</span></span>
                    <Badge tone={l.status === "active" ? "up" : l.status === "draft" ? "neutral" : "forecast"}>{l.status === "active" ? t("st_active") : tm(`status_${l.status}`)}</Badge>
                    <span className="w-28 text-end font-semibold tabular">{money(l.pricePerUnit, l.currency ?? "", locale)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** /app/sell/offers: respond to buyers' offers (accept, decline or counter). */
export function SellerOffers() {
  const t = useTranslations("sell");
  const locale = useLocale();
  const offers = useOffers("seller");
  const respond = useRespondOffer();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [counterFor, setCounterFor] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const act = (o: S["Offer"], action: S["OfferResponse"]["action"], extra: Partial<S["OfferResponse"]> = {}) =>
    respond.mutate({ id: o.id!, body: { action, ...extra } }, { onSuccess: () => { setCounterFor(null); setPrice(""); fb.success(t("offerDone")); }, onError: (e) => fb.error(problem(e as never)) });
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t("offers")}</h1>
      {offers.isPending ? <Skeleton className="h-64" /> : !offers.data?.length ? <EmptyState icon={Tag} title={t("noOffers")} /> : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {offers.data.map((o) => (
              <li key={o.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/app/marketplace/${o.listingId}`} className="font-medium hover:text-brand hover:underline">{t("offerFrom", { listing: o.listingId?.slice(0, 8) ?? "" })}</Link>
                    <p className="text-sm tabular">{number(Number(o.quantity), locale)} × {o.pricePerUnit}</p>
                    {o.status === "open" && o.expiresAt ? <p className="text-xs text-muted-fg">{t("expires", { time: relativeTime(o.expiresAt, locale) })}</p> : null}
                  </div>
                  <Badge tone={o.status === "open" ? "forecast" : o.status === "accepted" ? "up" : "neutral"}>{t.has(`st_${o.status}`) ? t(`st_${o.status}`) : o.status}</Badge>
                  {o.status === "open" ? (
                    <span className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => act(o, "accept")} disabled={respond.isPending}>{t("accept")}</Button>
                      <Button size="sm" variant="outline" onClick={() => setCounterFor(counterFor === o.id ? null : o.id!)} aria-expanded={counterFor === o.id}>{t("counter")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => act(o, "reject")} disabled={respond.isPending}>{t("reject")}</Button>
                    </span>
                  ) : null}
                </div>
                {counterFor === o.id ? (
                  <form onSubmit={(e) => { e.preventDefault(); if (Number(price) > 0) act(o, "counter", { pricePerUnit: price }); }} className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1"><Label htmlFor={`ctr-${o.id}`}>{t("counterPrice")}</Label><Input id={`ctr-${o.id}`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="w-32" /></div>
                    <Button type="submit" size="sm" disabled={!(Number(price) > 0) || respond.isPending}>{t("counterSend")}</Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
