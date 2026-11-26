"use client";
import { Check, CreditCard, Loader2, Minus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useEffect, useRef, useState } from "react";
import { RangeTabs } from "@/components/agri/range-tabs";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Badge, Button, Card, CardTitle, Skeleton } from "@/components/ui/primitives";
import type { S } from "@/lib/api/browser";
import { useCancelSubscription, useCheckout, useMe, usePlans, useSubscription } from "@/lib/api/queries";
import { money, number, pctPlain } from "@/lib/format";
import { cn, pick } from "@/lib/utils";
import { PageTitle } from "./common";

const KNOWN = ["paystack", "flutterwave", "stripe"] as const;
type Provider = (typeof KNOWN)[number];
const BRAND: Record<Provider, string> = { paystack: "Paystack", flutterwave: "Flutterwave", stripe: "Stripe" };
/** Checkout options from the build (NEXT_PUBLIC_BILLING_PROVIDERS); unknown names are ignored. Exported for tests. */
export function configuredProviders(raw = process.env.NEXT_PUBLIC_BILLING_PROVIDERS ?? "paystack"): Provider[] {
  const list = raw.split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter((x): x is Provider => (KNOWN as readonly string[]).includes(x));
  return [...new Set(list)];
}

const CHECKOUT_DOMAINS = ["paystack.com", "flutterwave.com", "stripe.com"];
/** Only https pages on the payment providers' own domains are opened (exported for tests). */
export function isTrustedCheckoutUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && CHECKOUT_DOMAINS.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
  } catch { return false; }
}

/** Yearly saving vs paying monthly for 12 months, in %; null when it isn't a saving. Exported for tests. */
export function yearlySaving(monthly?: string, yearly?: string): number | null {
  const m = Number(monthly), y = Number(yearly);
  if (!Number.isFinite(m) || !Number.isFinite(y) || m <= 0 || y <= 0) return null;
  const pct = ((m * 12 - y) / (m * 12)) * 100;
  return pct >= 1 ? Math.round(pct) : null;
}

const ENT_ROWS: (keyof S["Entitlements"])[] = ["forecast_horizons", "history_range", "alerts_max", "alert_channels", "reports_per_month", "report_formats", "export_insights", "recommendations", "api_daily_quota", "api_keys_max", "seats"];
const INTERVALS = ["monthly", "yearly"] as const;
const POLL_MS = 3_000, POLL_MAX = 20;

/** /app/billing (mockup: Plan & billing). Payment happens on the provider's hosted page; the webhook updates the plan. */
export function BillingPage() {
  const t = useTranslations("bil");
  const providers = configuredProviders();
  const names = providers.map((p) => BRAND[p]).join(", ");
  return (
    <div className="space-y-6">
      <PageTitle title={t("title")} subtitle={t("intro", { providers: names || "—" })} />
      <ReturnBanner />
      <CurrentPlan />
      <Plans providers={providers} />
    </div>
  );
}

function ReturnBanner() {
  const t = useTranslations("bil");
  const locale = useLocale();
  const fb = useFeedback();
  const sub = useSubscription();
  const plans = usePlans(useMe().data?.country ?? "");
  const [q, setQ] = useQueryStates({ checkout: parseAsString, want: parseAsStringLiteral(["premium", "organisation"] as const) });
  const [tries, setTries] = useState(0);
  const done = useRef(false);
  const active = q.checkout === "return" && q.want != null;
  const reached = active && sub.data?.plan === q.want;
  const planName = pick(plans.data?.find((p) => p.code === q.want)?.name, locale) || q.want || "";

  useEffect(() => {
    if (!active || reached || tries >= POLL_MAX) return;
    const id = setTimeout(() => { void sub.refetch(); setTries((n) => n + 1); }, POLL_MS);
    return () => clearTimeout(id);
  }, [active, reached, tries, sub]);
  useEffect(() => {
    if (reached && !done.current) { done.current = true; fb.success(t("confirmed", { plan: planName })); void setQ({ checkout: null, want: null }); }
  }, [reached, fb, t, planName, setQ]);

  if (!active || reached) return null;
  const waiting = tries < POLL_MAX;
  return (
    <Card role="status" className="flex flex-wrap items-center gap-3 bg-info">
      {waiting ? <Loader2 aria-hidden className="size-5 animate-spin text-brand" /> : null}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{t("confirming")}</p>
        <p className="text-sm text-muted-fg">{waiting ? t("confirmingBody") : t("notYet")}</p>
      </div>
      {!waiting ? <Button variant="outline" size="sm" onClick={() => { setTries(0); void sub.refetch(); }}>{t("refresh")}</Button> : null}
    </Card>
  );
}

function entitlementText(v: unknown, k: keyof S["Entitlements"], t: (k: string, v?: Record<string, number>) => string, locale: string) {
  if (typeof v === "boolean") return v ? <Check aria-label={t("yes")} className="size-4 text-up" /> : <Minus aria-label={t("no")} className="size-4 text-muted-fg" />;
  if (Array.isArray(v)) return k === "forecast_horizons" ? v.map((m) => t("months", { n: Number(m) })).join(", ") : v.join(", ");
  if (typeof v === "number") return number(v, locale);
  return "—";
}

function CurrentPlan() {
  const t = useTranslations("bil");
  const tp = useTranslations("pub");
  const locale = useLocale();
  const me = useMe();
  const sub = useSubscription();
  const plans = usePlans(me.data?.country ?? "");
  const cancel = useCancelSubscription();
  const fb = useFeedback();
  const problem = useProblemMessage();
  if (sub.isPending) return <Skeleton className="h-48" />;
  if (sub.isError || !sub.data) return null;
  const s = sub.data;
  const planName = pick(plans.data?.find((p) => p.code === s.plan)?.name, locale) || s.plan;
  const end = s.subscription?.currentPeriodEnd ? new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(s.subscription.currentPeriodEnd)) : null;
  const inStore = s.subscription?.provider === "revenuecat";
  const viaOrg = s.source === "organisation";

  const onCancel = async () => {
    const ok = await fb.confirm({ title: t("cancelTitle"), description: t("cancelBody", { plan: planName, date: end ?? "—" }), confirmLabel: t("cancelConfirm"), cancelLabel: t("keep"), destructive: true });
    if (ok) cancel.mutate(undefined, { onSuccess: () => fb.success(t("cancelled", { date: end ?? "—" })), onError: (e) => fb.error(problem(e as never)) });
  };

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-fg">{t("current")}</p>
          <p className="mt-1 flex items-center gap-2 text-2xl font-semibold">{planName}<Badge tone="brand">{t(`source_${s.source ?? "none"}`)}</Badge></p>
          {s.subscription ? (
            <p className="mt-1 text-sm text-muted-fg">
              {s.subscription.cancelAtPeriodEnd ? t("cancelScheduled", { plan: planName, date: end ?? "—" }) : end ? t("renews", { date: end }) : null}
              {s.subscription.status && s.subscription.status !== "active" ? ` · ${t("status", { status: s.subscription.status })}` : ""}
            </p>
          ) : null}
        </div>
        {s.subscription && !s.subscription.cancelAtPeriodEnd && !viaOrg ? (
          inStore ? <p className="max-w-xs text-sm text-muted-fg">{t("manageInStore")}</p>
            : <Button variant="outline" size="sm" onClick={() => void onCancel()} disabled={cancel.isPending}>{t("cancel")}</Button>
        ) : viaOrg ? <p className="max-w-xs text-sm text-muted-fg">{t("orgManaged")}</p> : null}
      </div>
      <div>
        <CardTitle className="text-base">{t("includes")}</CardTitle>
        <dl className="mt-2 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
          {ENT_ROWS.filter((k) => s.entitlements?.[k] !== undefined).map((k) => (
            <div key={k} className="flex items-center justify-between gap-3 border-b border-border py-1.5">
              <dt className="text-muted-fg">{tp(`ent_${k}`)}</dt><dd className="text-end font-medium tabular">{entitlementText(s.entitlements[k], k, tp, locale)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Card>
  );
}

function Plans({ providers }: { providers: Provider[] }) {
  const t = useTranslations("bil");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const plans = usePlans(cc);
  const sub = useSubscription();
  const checkout = useCheckout();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]>("monthly");
  const [provider, setProvider] = useState<Provider | undefined>(providers[0]);
  const [going, setGoing] = useState(false);
  const isOrgAdmin = me.data?.role === "org_admin" && Boolean(me.data?.organisationId);

  if (plans.isPending) return <Skeleton className="h-72" />;
  if (plans.isError || !plans.data?.length) return <Card className="text-sm text-muted-fg">{t("plansUnavailable")}</Card>;
  const currency = Object.keys(plans.data.find((p) => p.code !== "free")?.prices ?? {})[0] ?? "";

  const start = (code: "premium" | "organisation") => {
    if (!provider) return;
    const returnUrl = `${window.location.origin}/${locale}/app/billing?checkout=return&want=${code}`;
    checkout.mutate({ plan: code, interval, provider, currency: currency || undefined, returnUrl, ...(code === "organisation" ? { organisationId: me.data!.organisationId! } : {}) }, {
      onSuccess: (s) => {
        if (!isTrustedCheckoutUrl(s.authorizationUrl)) { fb.error(t("untrusted")); return; }
        setGoing(true);
        window.location.assign(s.authorizationUrl);
      },
      onError: (e) => fb.error(problem(e as never)),
    });
  };

  return (
    <section aria-labelledby="plans" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="plans" className="text-lg font-semibold">{t("plans")}</h2>
        <div className="flex flex-wrap items-end gap-4">
          <RangeTabs size="sm" label={t("billingPeriod")} value={interval} onChange={setInterval} options={INTERVALS.map((i) => ({ value: i, label: t(i) }))} />
          {providers.length > 1 ? (
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-fg">{t("payWith")}
              <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)} className="h-9 rounded-xl border border-border bg-background px-2 text-sm text-foreground">
                {providers.map((p) => <option key={p} value={p}>{t(`provider_${p}`)}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      </div>
      {going ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 aria-hidden className="size-4 animate-spin" />{t("redirecting")}</p> : null}
      <ul className="grid gap-4 md:grid-cols-3">
        {plans.data.map((p) => {
          const price = p.prices?.[currency];
          const amount = interval === "monthly" ? price?.monthly : price?.yearly;
          const saving = interval === "yearly" ? yearlySaving(price?.monthly, price?.yearly) : null;
          const current = sub.data?.plan === p.code;
          const name = pick(p.name, locale) || p.code;
          const orgLocked = p.code === "organisation" && !isOrgAdmin;
          return (
            <li key={p.code}>
              <Card className={cn("flex h-full flex-col gap-3", current && "ring-2 ring-ring")}>
                <div className="flex items-center justify-between gap-2"><h3 className="text-lg font-semibold">{name}</h3>{current ? <Badge tone="up">{t("currentBadge")}</Badge> : null}</div>
                <p className="text-3xl font-semibold tabular">
                  {p.code === "free" ? t("free") : amount ? <>{money(amount, currency, locale)}<span className="text-base font-normal text-muted-fg">{interval === "monthly" ? t("perMonth") : t("perYear")}</span></> : <span className="text-base font-normal text-muted-fg">{t("noPrice", { currency })}</span>}
                </p>
                {saving ? <Badge tone="up" className="w-fit">{t("save", { pct: pctPlain(saving, locale, 0) })}</Badge> : null}
                <div className="mt-auto space-y-1.5">
                  {p.code !== "free" && !current ? (
                    <>
                      <Button className="w-full" disabled={!amount || !provider || orgLocked || checkout.isPending || going} onClick={() => start(p.code as "premium" | "organisation")}>
                        {checkout.isPending && checkout.variables?.plan === p.code ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <CreditCard aria-hidden className="size-4" />}
                        {sub.data?.plan === "free" ? t("upgrade", { plan: name }) : t("choose", { plan: name })}
                      </Button>
                      {orgLocked ? <p className="text-xs text-muted-fg">{t("orgOnly")}</p> : null}
                    </>
                  ) : null}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
