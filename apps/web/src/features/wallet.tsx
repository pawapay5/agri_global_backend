"use client";
import { Landmark, Plus, Smartphone } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { StatCard } from "@/components/agri/stat-card";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Badge, Button, Card, CardTitle, FieldError, Input, Label, Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import type { S } from "@/lib/api/browser";
import { useAddPayoutAccount, useLedger, usePayoutAccounts, usePayouts, useRequestPayout, useSellerProfile, useWallet } from "@/lib/api/market";
import { money, relativeTime } from "@/lib/format";
import { configuredProviders } from "./billing";

const PROVIDER = configuredProviders().find((p): p is "paystack" | "flutterwave" => p === "paystack" || p === "flutterwave") ?? "paystack";

/** Amount must be a positive number within the wallet's limits and what's available (exported for tests). */
export function payoutProblem(amount: string, available: number, limits?: { min?: string; max?: string }): boolean {
  const n = Number(amount);
  if (!amount.trim() || !Number.isFinite(n) || n <= 0 || n > available) return true;
  if (limits?.min && n < Number(limits.min)) return true;
  if (limits?.max && n > Number(limits.max)) return true;
  return false;
}

/** /app/sell/wallet (no mockup): balances, withdraw to a payout account, payouts and the ledger. */
export function WalletPage() {
  const t = useTranslations("sell");
  const tm = useTranslations("mp");
  const locale = useLocale();
  const wallet = useWallet();
  const profile = useSellerProfile();
  const accounts = usePayoutAccounts();
  const payouts = usePayouts();
  const ledger = useLedger();
  const request = useRequestPayout();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState("");
  const [bad, setBad] = useState(false);
  if (wallet.isPending) return <Skeleton className="h-96" />;
  const w = wallet.data;
  const cur = w?.currency ?? "";
  const available = Number(w?.available ?? 0) || 0;
  const verified = profile.data?.kycStatus === "verified";
  const accountId = account || accounts.data?.find((a) => a.isDefault)?.id || accounts.data?.[0]?.id || "";

  const withdraw = (e: React.FormEvent) => {
    e.preventDefault();
    if (payoutProblem(amount, available, w?.limits)) { setBad(true); document.getElementById("po-amount")?.focus(); return; }
    setBad(false);
    request.mutate({ amount: amount.trim(), ...(accountId ? { accountId } : {}) }, { onSuccess: () => { setAmount(""); fb.success(t("payoutRequested")); }, onError: (x) => fb.error(problem(x as never)) });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("wallet")}</h1>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("available")} value={money(w?.available, cur, locale)} />
        <StatCard label={t("inEscrow")} value={money(w?.inEscrow, cur, locale)} />
        <StatCard label={t("pendingPayouts")} value={money(w?.pendingPayouts, cur, locale)} />
        <StatCard label={t("lifetime")} value={money(w?.lifetimeEarnings, cur, locale)} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3">
          <CardTitle>{t("withdraw")}</CardTitle>
          {!verified ? <p className="rounded-xl bg-info p-3 text-sm">{t("needKyc")} <Link href="/app/sell/profile" className="font-semibold text-brand hover:underline">{t("kyc")}</Link></p> : !accounts.data?.length ? <p className="text-sm text-muted-fg">{t("noAccounts")}</p> : (
            <form onSubmit={withdraw} noValidate className="space-y-3">
              <div className="space-y-1"><Label htmlFor="po-amount">{t("amount")} ({cur})</Label>
                <Input id="po-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={bad} aria-describedby="po-limits" />
                {w?.limits?.min || w?.limits?.max ? <p id="po-limits" className="text-xs text-muted-fg">{t("withdrawLimits", { min: money(w.limits.min ?? "0", cur, locale), max: money(w.limits.max ?? available, cur, locale) })}</p> : null}
                <FieldError>{bad ? t("badNumber") : null}</FieldError>
              </div>
              <div className="space-y-1"><Label htmlFor="po-acct">{t("accounts")}</Label>
                <select id="po-acct" value={accountId} onChange={(e) => setAccount(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm">
                  {accounts.data.map((a) => <option key={a.id} value={a.id}>{a.label}{a.isDefault ? ` (${t("default")})` : ""}</option>)}
                </select>
              </div>
              <Button type="submit" disabled={request.isPending || available <= 0}>{t("withdraw")}</Button>
            </form>
          )}
        </Card>
        <Accounts accounts={accounts.data ?? []} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3">
          <CardTitle>{t("payouts")}</CardTitle>
          {!payouts.data?.length ? <p className="text-sm text-muted-fg">{t("noPayouts")}</p> : (
            <ul className="divide-y divide-border text-sm">
              {payouts.data.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <span><span className="font-medium tabular">{money(p.amount, p.currency ?? cur, locale)}</span>{p.failureReason ? <span className="block text-xs text-down">{p.failureReason}</span> : null}</span>
                  <Badge tone={p.status === "paid" ? "up" : p.status === "failed" ? "down" : "forecast"}>{p.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="space-y-3">
          <CardTitle>{t("ledger")}</CardTitle>
          {!ledger.data?.pages[0]?.data.length ? <p className="text-sm text-muted-fg">{t("noLedger")}</p> : (
            <>
              <ul className="divide-y divide-border text-sm">
                {ledger.data.pages.flatMap((p) => p.data).map((raw, i) => {
                  const e = raw as { id?: string; kind?: string; description?: string; amount?: string; currency?: string; createdAt?: string };
                  const n = Number(e.amount);
                  return (
                    <li key={e.id ?? i} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0"><span className="block truncate">{e.description ?? e.kind}</span>{e.createdAt ? <span className="text-xs text-muted-fg">{relativeTime(e.createdAt, locale)}</span> : null}</span>
                      <span className={`tabular font-medium ${n < 0 ? "text-down" : "text-up"}`}>{money(e.amount, e.currency ?? cur, locale)}</span>
                    </li>
                  );
                })}
              </ul>
              {ledger.hasNextPage ? <Button variant="outline" size="sm" onClick={() => void ledger.fetchNextPage()}>{tm("loadMore")}</Button> : null}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function Accounts({ accounts }: { accounts: S["PayoutAccount"][] }) {
  const t = useTranslations("sell");
  const tm = useTranslations("mp");
  const add = useAddPayoutAccount();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ type: "momo" as "momo" | "bank", network: "mtn" as "mtn" | "telecel" | "airteltigo", bankCode: "", accountNumber: "", accountName: "", isDefault: accounts.length === 0 });
  const [bad, setBad] = useState(false);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.accountNumber.trim() || !f.accountName.trim() || (f.type === "bank" && !f.bankCode.trim())) { setBad(true); return; }
    setBad(false);
    add.mutate({ type: f.type, provider: PROVIDER, accountNumber: f.accountNumber.trim(), accountName: f.accountName.trim(), isDefault: f.isDefault, ...(f.type === "momo" ? { network: f.network } : { bankCode: f.bankCode.trim() }) }, {
      onSuccess: () => { setOpen(false); setF({ ...f, accountNumber: "", accountName: "", bankCode: "" }); fb.success(t("accountAdded")); }, onError: (x) => fb.error(problem(x as never)),
    });
  };
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2"><CardTitle>{t("accounts")}</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="acct-form"><Plus aria-hidden className="size-4" />{t("addAccount")}</Button>
      </div>
      {accounts.length ? (
        <ul className="space-y-2 text-sm">{accounts.map((a) => <li key={a.id} className="flex items-center gap-2">{a.type === "bank" ? <Landmark aria-hidden className="size-4" /> : <Smartphone aria-hidden className="size-4" />}<span className="flex-1">{a.label}</span>{a.isDefault ? <Badge tone="brand">{t("default")}</Badge> : null}</li>)}</ul>
      ) : <p className="text-sm text-muted-fg">{t("noAccounts")}</p>}
      {open ? (
        <form id="acct-form" onSubmit={submit} noValidate className="space-y-3 border-t border-border pt-3">
          <fieldset className="flex gap-4"><legend className="sr-only">{t("accounts")}</legend>
            {(["momo", "bank"] as const).map((x) => <label key={x} className="flex items-center gap-1.5 text-sm"><input type="radio" checked={f.type === x} onChange={() => setF({ ...f, type: x })} className="size-4 accent-brand" />{t(`acct_${x}`)}</label>)}
          </fieldset>
          {f.type === "momo" ? (
            <div className="space-y-1"><Label htmlFor="ac-net">{tm("network")}</Label>
              <select id="ac-net" value={f.network} onChange={(e) => setF({ ...f, network: e.target.value as typeof f.network })} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm">
                {(["mtn", "telecel", "airteltigo"] as const).map((n) => <option key={n} value={n}>{tm(`net_${n}`)}</option>)}
              </select>
            </div>
          ) : <div className="space-y-1"><Label htmlFor="ac-bank">{t("bankCode")}</Label><Input id="ac-bank" value={f.bankCode} maxLength={20} onChange={(e) => setF({ ...f, bankCode: e.target.value })} /></div>}
          <div className="space-y-1"><Label htmlFor="ac-num">{t("accountNumber")}</Label><Input id="ac-num" value={f.accountNumber} maxLength={30} inputMode="tel" onChange={(e) => setF({ ...f, accountNumber: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="ac-name">{t("accountName")}</Label><Input id="ac-name" value={f.accountName} maxLength={120} autoComplete="name" onChange={(e) => setF({ ...f, accountName: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} className="size-4 accent-brand" />{t("makeDefault")}</label>
          <FieldError>{bad ? t("required") : null}</FieldError>
          <Button type="submit" size="sm" disabled={add.isPending}>{t("addAccount")}</Button>
        </form>
      ) : null}
    </Card>
  );
}
