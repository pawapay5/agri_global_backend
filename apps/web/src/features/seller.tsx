"use client";
import { BadgeCheck, BarChart3, Package, Plus, Store, Tag, UserRound, Wallet } from "lucide-react";
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

const noProfile = (e: unknown) => e instanceof ApiError && e.status === 404;
const KYC_TONE = { none: "neutral", pending: "forecast", verified: "up", rejected: "down" } as const;

/** /app/sell: setup prompt for new sellers; otherwise KPIs, wallet and what needs attention. */
export function SellerOverview() {
  const t = useTranslations("sell");
  const locale = useLocale();
  const profile = useSellerProfile();
  const summary = useSellerSummary("30d");
  const wallet = useWallet();
  const offers = useOffers("seller", "open");
  if (profile.isPending) return <Skeleton className="h-72" />;
  if (noProfile(profile.error)) return (
    <EmptyState icon={Store} title={t("setupTitle")} description={t("setupBody")} action={<Link href="/app/sell/profile" className={buttonVariants()}>{t("setup")}</Link>} />
  );
  const p = profile.data;
  const s = summary.data;
  const w = wallet.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">{p?.displayName ?? t("title")}{p?.verified ? <BadgeCheck aria-label={t("kyc_verified")} className="size-5 text-brand" /> : null}</h1>
          <p className="mt-1 text-sm text-muted-fg">{t("intro")}</p>
        </div>
        <Link href="/app/sell/listings/new" className={buttonVariants()}><Plus aria-hidden className="size-4" />{t("newListing")}</Link>
      </div>
      {p && p.kycStatus !== "verified" ? (
        <Card className="flex flex-wrap items-center gap-3 bg-info text-sm">
          <Badge tone={KYC_TONE[p.kycStatus ?? "none"]}>{t(`kyc_${p.kycStatus ?? "none"}`)}</Badge>
          <span className="flex-1">{t("setupBody")}</span>
          <Link href="/app/sell/profile" className="font-semibold text-brand hover:underline">{t("kyc")}</Link>
        </Card>
      ) : null}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("revenue")} value={s ? money(s.revenue?.value, s.currency ?? "", locale) : "—"} delta={s?.revenue?.changePct != null ? { value: s.revenue.changePct, period: t("vsPrevious") } : undefined} />
        <StatCard label={t("ordersPlaced")} value={s ? number(s.ordersPlaced?.value, locale) : "—"} delta={s?.ordersPlaced?.changePct != null ? { value: s.ordersPlaced.changePct, period: t("vsPrevious") } : undefined} />
        <StatCard label={t("available")} value={w ? money(w.available, w.currency ?? "", locale) : "—"} footer={w ? <span className="text-xs text-muted-fg">{t("inEscrow")}: {money(w.inEscrow, w.currency ?? "", locale)}</span> : undefined} />
        <StatCard label={t("offers")} value={offers.data ? number(offers.data.length, locale) : "—"} footer={<Link href="/app/sell/offers" className="text-xs font-semibold text-brand hover:underline">{t("offers")} →</Link>} />
      </div>
    </div>
  );
}

const ID_TYPES = ["national_id", "passport", "voter_id", "drivers_licence"] as const;

/** /app/sell/profile: shop details and identity verification (KYC goes to the provider; never shown to buyers). */
export function SellerProfilePage() {
  const t = useTranslations("sell");
  const locale = useLocale();
  const me = useMe();
  const regions = useRegions(me.data?.country ?? "");
  const profile = useSellerProfile();
  const save = useSaveSellerProfile();
  const kyc = useSubmitKyc();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const p = profile.data;
  const [name, setName] = useState<string | null>(null);
  const [bio, setBio] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [nameErr, setNameErr] = useState(false);
  const [idType, setIdType] = useState<(typeof ID_TYPES)[number]>("national_id");
  const [idNumber, setIdNumber] = useState("");
  const [selfie, setSelfie] = useState<File | undefined>();
  const [kycErr, setKycErr] = useState<string | null>(null);
  if (profile.isPending) return <Skeleton className="h-96" />;
  const v = { name: name ?? p?.displayName ?? "", bio: bio ?? p?.bio ?? "", region: region ?? p?.regionId ?? "" };

  const submitProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (v.name.trim().length < 2 || v.name.trim().length > 80) { setNameErr(true); document.getElementById("sp-name")?.focus(); return; }
    setNameErr(false);
    save.mutate({ displayName: v.name.trim(), ...(v.bio.trim() ? { bio: v.bio.trim().slice(0, 1000) } : {}), ...(v.region ? { regionId: v.region } : {}) }, { onSuccess: () => fb.success(t("profileSaved")), onError: (x) => fb.error(problem(x as never)) });
  };
  const submitKyc = (e: React.FormEvent) => {
    e.preventDefault();
    if (!idNumber.trim() || !selfie) { setKycErr(t("required")); return; }
    if (tooBig(selfie)) { setKycErr(t("fileTooBig", { mb: MAX_UPLOAD_MB })); return; }
    setKycErr(null);
    kyc.mutate({ idType, idNumber: idNumber.trim(), selfie }, { onSuccess: () => { setIdNumber(""); setSelfie(undefined); fb.success(t("kycSent")); }, onError: (x) => fb.error(problem(x as never)) });
  };
  const status = p?.kycStatus ?? "none";

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <Card className="space-y-4">
        <CardTitle>{t("profile")}</CardTitle>
        <form onSubmit={submitProfile} noValidate className="space-y-3">
          <div className="space-y-1"><Label htmlFor="sp-name">{t("displayName")}</Label><Input id="sp-name" value={v.name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-invalid={nameErr} required /><FieldError>{nameErr ? t("required") : null}</FieldError></div>
          <div className="space-y-1"><Label htmlFor="sp-bio">{t("bio")}</Label><textarea id="sp-bio" rows={4} maxLength={1000} value={v.bio} onChange={(e) => setBio(e.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></div>
          <div className="space-y-1"><Label htmlFor="sp-region">{t("region")}</Label>
            <select id="sp-region" value={v.region} onChange={(e) => setRegion(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm">
              <option value="">—</option>{(regions.data ?? []).map((r) => <option key={r.id} value={r.id}>{pick(r.name, locale)}</option>)}
            </select>
          </div>
          <Button type="submit" disabled={save.isPending}>{t("saveProfile")}</Button>
        </form>
      </Card>
      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3"><CardTitle>{t("kyc")}</CardTitle><Badge tone={KYC_TONE[status]}>{t(`kyc_${status}`)}</Badge></div>
        <p className="text-sm text-muted-fg">{t("kycPrivacy")}</p>
        {p && (status === "none" || status === "rejected") ? (
          <form onSubmit={submitKyc} noValidate className="space-y-3">
            <div className="space-y-1"><Label htmlFor="kyc-type">{t("idType")}</Label>
              <select id="kyc-type" value={idType} onChange={(e) => setIdType(e.target.value as (typeof ID_TYPES)[number])} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm">
                {ID_TYPES.map((x) => <option key={x} value={x}>{t(`id_${x}`)}</option>)}
              </select>
            </div>
            <div className="space-y-1"><Label htmlFor="kyc-num">{t("idNumber")}</Label><Input id="kyc-num" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} autoComplete="off" maxLength={40} /></div>
            <div className="space-y-1"><Label htmlFor="kyc-selfie">{t("selfie")}</Label><input id="kyc-selfie" type="file" accept={IMAGE_ACCEPT} capture="user" onChange={(e) => setSelfie(e.target.files?.[0])} className="block text-sm" /></div>
            <FieldError>{kycErr}</FieldError>
            <Button type="submit" disabled={kyc.isPending}>{t("submitKyc")}</Button>
          </form>
        ) : !p ? <p className="text-sm text-muted-fg">{t("setupBody")}</p> : null}
      </Card>
    </div>
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
