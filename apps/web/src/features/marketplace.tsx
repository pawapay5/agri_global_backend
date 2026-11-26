"use client";
import { AlertTriangle, BadgeCheck, Flag, Heart, MessageSquare, Package, Search, ShoppingCart, Star, Tag } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsFloat, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useState } from "react";
import { EmptyState } from "@/components/agri/empty-state";
import { RangeTabs } from "@/components/agri/range-tabs";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { ReportDialog } from "@/components/feedback/report-dialog";
import { Badge, Button, Card, CardTitle, Input, Label, Skeleton } from "@/components/ui/primitives";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import type { S } from "@/lib/api/browser";
import { useCart, useFavourite, useFavourites, useListing, useListings, useMakeOffer, useSeller, useSellerReviews, useStartConversation, useUpsertCartItem } from "@/lib/api/market";
import { useCommodities, useMe, useRegions } from "@/lib/api/queries";
import { money, number, pctPlain, unitLabel } from "@/lib/format";
import { cn, pick } from "@/lib/utils";
import { isHttp } from "./market-common";

const SORTS = ["recent", "lowest", "highest"] as const;
const TYPES = ["all", "product", "service"] as const;

/** Sub-navigation for the buyer marketplace. */
export function MarketplaceNav() {
  const t = useTranslations("mp");
  const path = usePathname();
  const cart = useCart();
  const count = cart.data?.groups?.reduce((n, g) => n + (g.items?.length ?? 0), 0) ?? 0;
  const items = [
    { href: "/app/marketplace", label: t("title"), icon: Search },
    { href: "/app/marketplace/saved", label: t("saved"), icon: Heart },
    { href: "/app/marketplace/cart", label: count ? `${t("cart")} (${count})` : t("cart"), icon: ShoppingCart },
    { href: "/app/marketplace/orders", label: t("orders"), icon: Package },
    { href: "/app/marketplace/offers", label: t("offers"), icon: Tag },
  ];
  return (
    <nav aria-label={t("title")} className="-mx-1 mb-6 overflow-x-auto px-1">
      <ul className="inline-flex gap-1 rounded-xl bg-muted p-1">
        {items.map(({ href, label, icon: Icon }) => {
          const on = href === "/app/marketplace" ? path === href : path === href || path.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link href={href} aria-current={on ? "page" : undefined} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium", on ? "bg-card shadow-sm" : "text-muted-fg hover:text-foreground")}>
                <Icon aria-hidden className="size-4" />{label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function ListingCard({ l }: { l: S["Listing"] }) {
  const t = useTranslations("mp");
  const locale = useLocale();
  const photo = l.photos?.[0]?.urls?.medium;
  return (
    <Link href={`/app/marketplace/${l.id}`} className="block h-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="flex h-full flex-col gap-2 overflow-hidden p-0 transition-shadow hover:shadow-md">
        <div className="aspect-[4/3] bg-muted">
          {isHttp(photo) ? (
            // eslint-disable-next-line @next/next/no-img-element -- seller upload from our storage
            <img src={photo} alt="" className="size-full object-cover" loading="lazy" />
          ) : <span className="grid size-full place-items-center text-muted-fg"><Package aria-hidden className="size-8" /></span>}
        </div>
        <div className="flex flex-1 flex-col gap-1 px-4 pb-4">
          <p className="line-clamp-2 font-semibold">{l.title}</p>
          <p className="text-lg font-semibold tabular">{money(l.pricePerUnit, l.currency ?? "", locale)} <span className="text-xs font-normal text-muted-fg">{t("perUnit", { unit: unitLabel(l.unit) })}</span></p>
          <p className="mt-auto flex flex-wrap items-center gap-x-2 text-xs text-muted-fg">
            <span className="inline-flex items-center gap-1">{l.seller?.verified ? <BadgeCheck aria-label={t("verified")} className="size-3.5 text-brand" /> : null}{l.seller?.displayName}</span>
            {l.distanceKm != null ? <span>· {t("km", { km: number(l.distanceKm, locale, { digits: 0 }) })}</span> : null}
            {l.status === "low_stock" || l.status === "sold_out" ? <Badge tone="forecast">{t(`status_${l.status}`)}</Badge> : null}
          </p>
        </div>
      </Card>
    </Link>
  );
}

/** /app/marketplace (no mockup): search and filters in the URL, infinite list. */
export function MarketplaceBrowse() {
  const t = useTranslations("mp");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const commodities = useCommodities(cc);
  const regions = useRegions(cc);
  const [f, setF] = useQueryStates({
    q: parseAsString.withDefault(""), type: parseAsStringLiteral(TYPES).withDefault("all"), commodity: parseAsString, region: parseAsString,
    min: parseAsFloat, max: parseAsFloat, sort: parseAsStringLiteral(SORTS).withDefault("recent"),
  });
  const [q, setQ] = useState(f.q);
  const listings = useListings(cc, { q: f.q, type: f.type === "all" ? undefined : f.type, commodityId: f.commodity ?? undefined, regionId: f.region ?? undefined, minPrice: f.min ?? undefined, maxPrice: f.max ?? undefined, sort: f.sort });
  const items = listings.data?.pages.flatMap((p) => p.data) ?? [];
  const select = "h-10 rounded-xl border border-border bg-background px-3 text-sm";

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold">{t("title")}</h1><p className="mt-1 text-sm text-muted-fg">{t("intro")}</p></div>
      <Card className="space-y-3">
        <form role="search" onSubmit={(e) => { e.preventDefault(); void setF({ q: q.trim() || null }); }} className="flex gap-2">
          <label className="relative flex-1"><span className="sr-only">{t("search")}</span>
            <Search aria-hidden className="absolute start-3 top-2.5 size-5 text-muted-fg" />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="ps-10" maxLength={100} />
          </label>
          <Button type="submit">{t("searchBtn")}</Button>
        </form>
        <div className="flex flex-wrap items-end gap-3">
          <RangeTabs size="sm" label={t("type")} value={f.type} onChange={(v) => void setF({ type: v === "all" ? null : v })} options={TYPES.map((x) => ({ value: x, label: t(`type_${x}`) }))} />
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-fg">{t("commodity")}
            <select value={f.commodity ?? ""} onChange={(e) => void setF({ commodity: e.target.value || null })} className={select}>
              <option value="">{t("anyCommodity")}</option>
              {(commodities.data?.data ?? []).map((c) => <option key={c.id} value={c.id}>{pick(c.name, locale)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-fg">{t("region")}
            <select value={f.region ?? ""} onChange={(e) => void setF({ region: e.target.value || null })} className={select}>
              <option value="">{t("anyRegion")}</option>
              {(regions.data ?? []).map((r) => <option key={r.id} value={r.id}>{pick(r.name, locale)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-fg">{t("minPrice")}
            <Input inputMode="decimal" defaultValue={f.min ?? ""} onBlur={(e) => { const n = Number(e.target.value); void setF({ min: e.target.value && n >= 0 ? n : null }); }} className="h-10 w-24" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-fg">{t("maxPrice")}
            <Input inputMode="decimal" defaultValue={f.max ?? ""} onBlur={(e) => { const n = Number(e.target.value); void setF({ max: e.target.value && n >= 0 ? n : null }); }} className="h-10 w-24" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-fg">{t("sort")}
            <select value={f.sort} onChange={(e) => void setF({ sort: e.target.value === "recent" ? null : (e.target.value as (typeof SORTS)[number]) })} className={select}>
              {SORTS.map((s) => <option key={s} value={s}>{t(`sort_${s}`)}</option>)}
            </select>
          </label>
        </div>
      </Card>
      {listings.isPending ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-72" />)}</div>
        : !items.length ? <EmptyState icon={Search} title={t("noResults")} /> : (
          <>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{items.map((l) => <li key={l.id}><ListingCard l={l} /></li>)}</ul>
            {listings.hasNextPage ? <Button variant="outline" onClick={() => void listings.fetchNextPage()} disabled={listings.isFetchingNextPage}>{t("loadMore")}</Button> : null}
          </>
        )}
    </div>
  );
}

/** /app/marketplace/saved */
export function SavedListings() {
  const t = useTranslations("mp");
  const favs = useFavourites();
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t("saved")}</h1>
      {favs.isPending ? <Skeleton className="h-72" /> : !favs.data?.data.length ? <EmptyState icon={Heart} title={t("favouritesEmpty")} />
        : <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{favs.data.data.map((l) => <li key={l.id}><ListingCard l={l} /></li>)}</ul>}
    </div>
  );
}

/** Quantity must be ≥ the minimum order and ≤ what's available (exported for tests). */
export function qtyProblem(qty: string, min: number, max: number): boolean {
  const n = Number(qty);
  return !qty.trim() || !Number.isFinite(n) || n <= 0 || n < min || n > max;
}

/** /app/marketplace/[id] (no mockup): photos, price check against the market, seller, buy / offer / message. */
export function ListingDetail({ id }: { id: string }) {
  const t = useTranslations("mp");
  const locale = useLocale();
  const router = useRouter();
  const me = useMe();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const listing = useListing(id);
  const seller = useSeller(listing.data?.sellerId);
  const reviews = useSellerReviews(listing.data?.sellerId);
  const fav = useFavourite();
  const addToCart = useUpsertCartItem();
  const offer = useMakeOffer();
  const chat = useStartConversation();
  const [qty, setQty] = useState("");
  const [offerPrice, setOfferPrice] = useState("");
  const [showOffer, setShowOffer] = useState(false);
  const [photo, setPhoto] = useState(0);

  if (listing.isPending) return <Skeleton className="h-96" />;
  if (listing.isError || !listing.data) return <EmptyState icon={Package} title={t("status_removed")} />;
  const l = listing.data;
  const unit = unitLabel(l.unit);
  const min = Number(l.minOrderQty ?? 0) || 0, max = Number(l.quantity ?? 0) || 0;
  const mine = l.sellerId === me.data?.id;
  const buyable = !mine && (l.status === "active" || l.status === "low_stock");
  const photos = (l.photos ?? []).filter((p) => isHttp(p.urls?.medium));
  const bad = qty !== "" && qtyProblem(qty, min, max);

  const add = () => {
    if (qtyProblem(qty, min, max)) return;
    addToCart.mutate({ listingId: l.id!, quantity: qty }, { onSuccess: () => fb.success(t("added")), onError: (e) => fb.error(problem(e as never)) });
  };
  const sendOffer = () => {
    if (qtyProblem(qty, min, max) || !(Number(offerPrice) > 0)) return;
    offer.mutate({ listingId: l.id!, body: { quantity: qty, pricePerUnit: offerPrice } }, { onSuccess: () => { setShowOffer(false); fb.success(t("offerSent")); }, onError: (e) => fb.error(problem(e as never)) });
  };
  const message = () => chat.mutate({ userId: l.sellerId!, listingId: l.id }, { onSuccess: (c) => router.push(`/app/messages/${c.id}`), onError: (e) => fb.error(problem(e as never)) });

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
        <Card className="space-y-3 p-3">
          {photos.length ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- seller upload from our storage */}
              <img src={photos[photo]?.urls.large && isHttp(photos[photo]?.urls.large) ? photos[photo]!.urls.large : photos[photo]!.urls.medium} alt={t("photos", { title: l.title ?? "" })} className="aspect-[4/3] w-full rounded-xl object-cover" />
              {photos.length > 1 ? (
                <ul className="flex gap-2" aria-label={t("photos", { title: l.title ?? "" })}>
                  {photos.map((p, i) => (
                    <li key={p.id}><button type="button" onClick={() => setPhoto(i)} aria-pressed={i === photo} aria-label={`${i + 1} / ${photos.length}`} className={cn("overflow-hidden rounded-lg ring-offset-2", i === photo && "ring-2 ring-ring")}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={isHttp(p.urls.thumb) ? p.urls.thumb : p.urls.medium} alt="" className="size-16 object-cover" />
                    </button></li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : <div className="grid aspect-[4/3] place-items-center rounded-xl bg-muted text-sm text-muted-fg">{t("noPhotos")}</div>}
        </Card>
        {l.description ? <Card><p className="whitespace-pre-wrap text-sm">{l.description}</p></Card> : null}
        <Card className="space-y-3">
          <CardTitle>{t("reviews")}</CardTitle>
          {!reviews.data?.data.length ? <p className="text-sm text-muted-fg">{t("noRating")}</p> : (
            <ul className="space-y-3 text-sm">
              {reviews.data.data.map((r, i) => {
                const rv = r as { rating?: number; comment?: string; buyerName?: string };
                return <li key={i}><p className="flex items-center gap-1"><Stars n={rv.rating ?? 0} />{rv.buyerName ? <span className="ms-1 text-muted-fg">{rv.buyerName}</span> : null}</p>{rv.comment ? <p className="mt-0.5">{rv.comment}</p> : null}</li>;
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="space-y-4 lg:col-span-2">
        <Card className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-xl font-bold">{l.title}</h1>
            {!mine ? (
              <button type="button" onClick={() => fav.mutate({ id: l.id!, on: !l.favourite }, { onError: (e) => fb.error(problem(e as never)) })} aria-pressed={Boolean(l.favourite)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-sm hover:bg-muted">
                <Heart aria-hidden className={cn("size-4", l.favourite && "fill-down text-down")} />{l.favourite ? t("unfavourite") : t("favourite")}
              </button>
            ) : null}
          </div>
          <p className="text-3xl font-semibold tabular">{money(l.pricePerUnit, l.currency ?? "", locale)} <span className="text-base font-normal text-muted-fg">{t("perUnit", { unit })}</span></p>
          {l.priceFlag && l.priceDeviationPct != null ? (
            <p className={cn("flex items-start gap-2 rounded-xl p-3 text-sm", l.priceFlag === "far_below_market" ? "bg-down/10 text-down-ink" : "bg-forecast/10 text-forecast-ink")}>
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />{t(l.priceFlag === "far_below_market" ? "priceLow" : "priceHigh", { pct: pctPlain(l.priceDeviationPct, locale, 0) })}
            </p>
          ) : null}
          <ul className="space-y-1 text-sm text-muted-fg">
            <li>{t("available", { qty: number(max, locale), unit })}{l.status !== "active" ? <Badge tone="forecast" className="ms-2">{t(`status_${l.status}`)}</Badge> : null}</li>
            {min ? <li>{t("minOrder", { qty: number(min, locale), unit })}</li> : null}
            {l.qualityGrade ? <li>{t("grade", { g: l.qualityGrade })}</li> : null}
            {l.harvestDate ? <li>{t("harvested", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${l.harvestDate}T00:00:00Z`)) })}</li> : null}
          </ul>

          {mine ? (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-muted p-3 text-sm"><span>{t("ownListing")}</span><Link href={`/app/sell/listings/${l.id}`} className="font-semibold text-brand hover:underline">{t("edit")}</Link></div>
          ) : buyable ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="qty">{t("quantity", { unit })}</Label>
                <Input id="qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} aria-invalid={bad} aria-describedby={bad ? "qty-err" : undefined} />
                {bad ? <p id="qty-err" className="text-xs text-down">{t("qtyError", { min: number(min || 0, locale), max: number(max, locale) })}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={add} disabled={!qty || bad || addToCart.isPending}><ShoppingCart aria-hidden className="size-4" />{t("addToCart")}</Button>
                <Button variant="outline" onClick={() => setShowOffer((s) => !s)} aria-expanded={showOffer} aria-controls="offer-form"><Tag aria-hidden className="size-4" />{t("makeOffer")}</Button>
              </div>
              {showOffer ? (
                <div id="offer-form" className="space-y-2 rounded-xl border border-border p-3">
                  <Label htmlFor="offer-price">{t("offerPrice", { unit })} ({l.currency})</Label>
                  <Input id="offer-price" inputMode="decimal" value={offerPrice} onChange={(e) => setOfferPrice(e.target.value)} />
                  <Button size="sm" onClick={sendOffer} disabled={!qty || bad || !(Number(offerPrice) > 0) || offer.isPending}>{t("makeOffer")}</Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>

        <Card className="space-y-2">
          <CardTitle className="text-base">{t("seller")}</CardTitle>
          <p className="flex items-center gap-1.5 font-semibold">{l.seller?.displayName ?? seller.data?.displayName}{(l.seller?.verified ?? seller.data?.verified) ? <BadgeCheck aria-label={t("verified")} className="size-4 text-brand" /> : null}</p>
          <p className="flex items-center gap-1 text-sm">
            {seller.data?.rating != null ? <><Stars n={Math.round(seller.data.rating)} /><span className="ms-1">{t("rating", { rating: number(seller.data.rating, locale, { digits: 1 }), n: seller.data.ratingCount ?? 0 })}</span></> : <span className="text-muted-fg">{t("noRating")}</span>}
          </p>
          {seller.data?.responseTimeMins != null ? <p className="text-xs text-muted-fg">{t("responds", { time: seller.data.responseTimeMins < 60 ? `${seller.data.responseTimeMins} min` : `${Math.round(seller.data.responseTimeMins / 60)} h` })}</p> : null}
          {!mine ? (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button variant="outline" size="sm" onClick={message} disabled={chat.isPending}><MessageSquare aria-hidden className="size-4" />{t("message")}</Button>
              <ReportDialog targetType="listing" targetId={l.id!} trigger={<button type="button" className="inline-flex items-center gap-1 text-xs text-muted-fg hover:underline"><Flag aria-hidden className="size-3.5" />{t("reportListing")}</button>} />
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

export function Stars({ n }: { n: number }) {
  const t = useTranslations("mp");
  const k = Math.max(0, Math.min(5, Math.round(n)));
  return (
    <span role="img" aria-label={t("stars", { n: k })} className="inline-flex">
      {Array.from({ length: 5 }, (_, i) => <Star key={i} aria-hidden className={cn("size-4", i < k ? "fill-forecast text-forecast" : "text-muted-fg")} />)}
    </span>
  );
}
