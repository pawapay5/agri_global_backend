"use client";
import { AlertTriangle, ShoppingCart, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { EmptyState } from "@/components/agri/empty-state";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Badge, Button, Card, CardTitle, FieldError, Input, Label, Skeleton } from "@/components/ui/primitives";
import { Link, useRouter } from "@/i18n/navigation";
import type { S } from "@/lib/api/browser";
import { useCart, useCheckoutCart, useOffers, useRemoveCartItem, useUpsertCartItem } from "@/lib/api/market";
import { useMe, useRegions } from "@/lib/api/queries";
import { money, number, relativeTime, unitLabel } from "@/lib/format";
import { pick } from "@/lib/utils";

type Option = "pickup" | "standard" | "express";
type PayMethod = S["CheckoutRequest"]["paymentMethod"];
const PAY: PayMethod[] = ["momo", "card", "pay_on_delivery"];

/** /app/marketplace/cart (no mockup): one group per seller with its delivery choice, then a single checkout. */
export function CartPage() {
  const t = useTranslations("mp");
  const locale = useLocale();
  const router = useRouter();
  const me = useMe();
  const regions = useRegions(me.data?.country ?? "");
  const cart = useCart();
  const remove = useRemoveCartItem();
  const upsert = useUpsertCartItem();
  const checkout = useCheckoutCart();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [delivery, setDelivery] = useState<Record<string, Option>>({});
  const [pay, setPay] = useState<PayMethod>("momo");
  const [addr, setAddr] = useState({ line1: "", town: "", regionId: "", phone: "" });
  const [addrError, setAddrError] = useState(false);

  if (cart.isPending) return <Skeleton className="h-96" />;
  const groups = cart.data?.groups ?? [];
  if (!groups.length) return <div className="space-y-5"><h1 className="text-2xl font-bold">{t("cart")}</h1><EmptyState icon={ShoppingCart} title={t("cartEmpty")} action={<Link href="/app/marketplace" className="font-semibold text-brand hover:underline">{t("title")}</Link>} /></div>;
  const problems = new Map((cart.data?.problems ?? []).map((p) => [p.listingId, p.code]));
  const optionOf = (g: (typeof groups)[number]) => delivery[g.sellerId!] ?? ((g.deliveryOptions?.[0]?.option as Option) || "pickup");
  const feeOf = (g: (typeof groups)[number]) => Number(g.deliveryOptions?.find((o) => o.option === optionOf(g))?.fee ?? 0) || 0;
  const currency = groups[0]?.currency ?? "";
  const total = groups.reduce((s, g) => s + (Number(g.subtotal) || 0) + feeOf(g), 0);
  const needsAddress = groups.some((g) => optionOf(g) !== "pickup");

  const place = () => {
    if (needsAddress && (!addr.line1.trim() || !addr.town.trim())) { setAddrError(true); document.getElementById("addr-line1")?.focus(); return; }
    setAddrError(false);
    checkout.mutate({
      paymentMethod: pay,
      delivery: groups.map((g) => ({ sellerId: g.sellerId!, option: optionOf(g) })),
      ...(needsAddress ? { address: { line1: addr.line1.trim(), town: addr.town.trim(), ...(addr.regionId ? { regionId: addr.regionId } : {}), ...(addr.phone.trim() ? { phone: addr.phone.trim() } : {}) } } : {}),
    }, {
      onSuccess: (r) => {
        const orders = r.orders ?? [];
        fb.success(t("ordersPlaced", { n: orders.length }));
        router.push(orders.length === 1 ? `/app/marketplace/orders/${orders[0]!.id}` : "/app/marketplace/orders");
      },
      onError: (e) => fb.error(problem(e as never)),
    });
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t("cart")}</h1>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {groups.map((g) => (
            <Card key={g.sellerId} className="space-y-3">
              <CardTitle className="text-base">{g.sellerName}</CardTitle>
              <ul className="divide-y divide-border">
                {(g.items ?? []).map((it) => {
                  const issue = problems.get(it.listingId);
                  return (
                    <li key={it.listingId} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <Link href={`/app/marketplace/${it.listingId}`} className="font-medium hover:text-brand hover:underline">{it.title || it.listingId}</Link>
                        <p className="text-xs text-muted-fg">{money(it.pricePerUnit, g.currency ?? "", locale)} / {unitLabel(it.unit)}</p>
                        {issue ? <p className="mt-1 flex items-center gap-1 text-xs text-down"><AlertTriangle aria-hidden className="size-3.5" />{t.has(`problem_${issue}`) ? t(`problem_${issue}`) : issue}</p> : null}
                      </div>
                      <label className="flex items-center gap-1.5 text-sm"><span className="sr-only">{t("quantity", { unit: unitLabel(it.unit) })}</span>
                        <Input inputMode="decimal" defaultValue={it.quantity} className="h-9 w-20" onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== it.quantity && Number(v) > 0) upsert.mutate({ listingId: it.listingId, quantity: v }, { onError: (x) => fb.error(problem(x as never)) }); }} />
                        <span className="text-muted-fg">{unitLabel(it.unit)}</span>
                      </label>
                      <span className="w-24 text-end font-medium tabular">{it.lineTotal ? money(it.lineTotal, g.currency ?? "", locale) : "—"}</span>
                      <button type="button" onClick={() => remove.mutate(it.listingId, { onError: (x) => fb.error(problem(x as never)) })} className="rounded-lg p-2 text-down hover:bg-down/10" aria-label={`${t("remove")}: ${it.title ?? ""}`}><Trash2 className="size-4" /></button>
                    </li>
                  );
                })}
              </ul>
              {g.deliveryOptions?.length ? (
                <fieldset className="space-y-1.5">
                  <legend className="text-sm font-medium">{t("delivery")}</legend>
                  {g.deliveryOptions.map((o) => (
                    <label key={o.option} className="flex items-center gap-2 text-sm">
                      <input type="radio" name={`del-${g.sellerId}`} checked={optionOf(g) === o.option} onChange={() => setDelivery((s) => ({ ...s, [g.sellerId!]: o.option as Option }))} className="size-4 accent-brand" />
                      {t.has(`delivery_${o.option}`) ? t(`delivery_${o.option}`) : o.option}
                      <span className="text-muted-fg">· {money(o.fee ?? "0", g.currency ?? "", locale)}{o.days ? ` · ${t("days", { n: o.days })}` : ""}</span>
                    </label>
                  ))}
                </fieldset>
              ) : null}
            </Card>
          ))}
        </div>

        <Card className="h-fit space-y-4">
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">{t("paymentMethod")}</legend>
            {PAY.map((p) => <label key={p} className="flex items-center gap-2 text-sm"><input type="radio" name="pay" checked={pay === p} onChange={() => setPay(p)} className="size-4 accent-brand" />{t(`pay_${p}`)}</label>)}
          </fieldset>
          {needsAddress ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("address")}</legend>
              <div className="space-y-1"><Label htmlFor="addr-line1">{t("line1")}</Label><Input id="addr-line1" value={addr.line1} maxLength={200} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} aria-invalid={addrError && !addr.line1.trim()} autoComplete="street-address" /></div>
              <div className="space-y-1"><Label htmlFor="addr-town">{t("town")}</Label><Input id="addr-town" value={addr.town} maxLength={80} onChange={(e) => setAddr({ ...addr, town: e.target.value })} aria-invalid={addrError && !addr.town.trim()} autoComplete="address-level2" /></div>
              <div className="space-y-1"><Label htmlFor="addr-region">{t("region")}</Label>
                <select id="addr-region" value={addr.regionId} onChange={(e) => setAddr({ ...addr, regionId: e.target.value })} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm">
                  <option value="">—</option>{(regions.data ?? []).map((r) => <option key={r.id} value={r.id}>{pick(r.name, locale)}</option>)}
                </select>
              </div>
              <div className="space-y-1"><Label htmlFor="addr-phone">{t("phone")}</Label><Input id="addr-phone" type="tel" value={addr.phone} maxLength={20} onChange={(e) => setAddr({ ...addr, phone: e.target.value })} autoComplete="tel" /></div>
              <FieldError>{addrError ? t("needAddress") : null}</FieldError>
            </fieldset>
          ) : null}
          <dl className="space-y-1 border-t border-border pt-3 text-sm">
            <div className="flex justify-between text-base font-semibold"><dt>{t("total")}</dt><dd className="tabular">{money(total, currency, locale)}</dd></div>
          </dl>
          <Button className="w-full" onClick={place} disabled={checkout.isPending || problems.size > 0}>{t("placeOrder")}</Button>
        </Card>
      </div>
    </div>
  );
}

/** /app/marketplace/offers: the buyer's offers; accepted ones go to the cart at the agreed price. */
export function BuyerOffers() {
  const t = useTranslations("mp");
  const ts = useTranslations("sell");
  const locale = useLocale();
  const offers = useOffers("buyer");
  const upsert = useUpsertCartItem();
  const fb = useFeedback();
  const problem = useProblemMessage();
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t("offers")}</h1>
      {offers.isPending ? <Skeleton className="h-48" /> : !offers.data?.length ? <EmptyState title={ts("noOffers")} /> : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {offers.data.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/app/marketplace/${o.listingId}`} className="font-medium hover:text-brand hover:underline">{o.listingId?.slice(0, 8)}</Link>
                  <p className="text-sm tabular">{number(Number(o.quantity), locale)} × {o.pricePerUnit}</p>
                  {o.status === "open" && o.expiresAt ? <p className="text-xs text-muted-fg">{ts("expires", { time: relativeTime(o.expiresAt, locale) })}</p> : null}
                </div>
                <Badge tone={o.status === "accepted" ? "up" : o.status === "open" || o.status === "countered" ? "forecast" : "neutral"}>{ts.has(`st_${o.status}`) ? ts(`st_${o.status}`) : o.status}</Badge>
                {o.status === "accepted" ? <Button size="sm" onClick={() => upsert.mutate({ listingId: o.listingId!, quantity: o.quantity!, offerId: o.id }, { onSuccess: () => fb.success(t("added")), onError: (e) => fb.error(problem(e as never)) })}>{t("addToCart")}</Button> : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
