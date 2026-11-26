"use client";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { useState } from "react";
import { EmptyState } from "@/components/agri/empty-state";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Button, Card, CardTitle, FieldError, Input, Label, Skeleton } from "@/components/ui/primitives";
import { ApiError, type S } from "@/lib/api/browser";
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from "@/lib/api/org";
import { useMe, useSubscription } from "@/lib/api/queries";
import { number, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageTitle, UpgradePrompt } from "./common";

/** The API's public address from the build; trailing slashes removed, only http(s) (exported for tests). */
export function apiBase(raw = process.env.NEXT_PUBLIC_API_PUBLIC_URL ?? ""): string | null {
  const v = raw.trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s/]+/i.test(v) ? v : null;
}

const ENDPOINTS = [
  { path: "/v1/public/markets", key: "ep_markets", query: "country={cc}" },
  { path: "/v1/public/commodities", key: "ep_commodities", query: "country={cc}" },
  { path: "/v1/public/prices", key: "ep_prices", query: "country={cc}" },
  { path: "/v1/public/forecasts", key: "ep_forecasts", query: "country={cc}" },
] as const;

/** /app/developers (no mockup): API keys with today's usage, one-time secret, revoke, and a quick start. */
export function DevelopersPage() {
  const t = useTranslations("dev");
  const locale = useLocale();
  const me = useMe();
  const sub = useSubscription();
  const keys = useApiKeys();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [name, setName] = useState("");
  const [bad, setBad] = useState(false);
  const [secret, setSecret] = useState<S["ApiKeyCreated"] | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const base = apiBase();
  const cc = me.data?.country ?? "GH";
  const ent = sub.data?.entitlements;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setBad(true); return; }
    setBad(false);
    create.mutate(name.trim().slice(0, 80), {
      onSuccess: (k) => { setName(""); setSecret(k ?? null); },
      onError: (x) => (x instanceof ApiError && x.status === 402 ? setLocked(x.detail ?? "") : fb.error(problem(x as never))),
    });
  };
  const onRevoke = async (k: S["ApiKey"]) => {
    if (!(await fb.confirm({ title: t("revokeTitle", { name: k.name ?? "" }), description: t("revokeBody"), confirmLabel: t("revoke"), destructive: true }))) return;
    revoke.mutate(k.id!, { onSuccess: () => fb.success(t("revoked")), onError: (x) => fb.error(problem(x as never)) });
  };
  const copy = async (v: string) => { try { await navigator.clipboard.writeText(v); fb.success(t("copied")); } catch { /* the key stays selectable on screen */ } };
  const example = `curl -H "X-API-Key: $AGRIPRICE_KEY" \\\n  "${base ?? "<API address>"}/v1/public/prices?country=${cc}"`;

  return (
    <div className="space-y-6">
      <PageTitle title={t("title")} subtitle={t("intro")} />
      {locked != null ? <UpgradePrompt detail={locked || undefined} /> : null}
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="space-y-4 lg:col-span-3">
          <CardTitle>{t("keys")}</CardTitle>
          {ent?.api_daily_quota != null && ent.api_keys_max != null ? <p className="text-sm text-muted-fg">{t("limits", { quota: number(ent.api_daily_quota, locale), keys: ent.api_keys_max })}</p> : null}
          <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1 space-y-1">
              <Label htmlFor="key-name">{t("keyName")}</Label>
              <Input id="key-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-invalid={bad} aria-describedby="key-name-hint" />
              <p id="key-name-hint" className="text-xs text-muted-fg">{t("keyNameHint")}</p>
            </div>
            <Button type="submit" disabled={create.isPending}><Plus aria-hidden className="size-4" />{t("create")}</Button>
            <FieldError>{bad ? t("nameBad") : null}</FieldError>
          </form>
          {keys.isPending ? <Skeleton className="h-32" /> : !keys.data?.length ? <EmptyState icon={KeyRound} title={t("noKeys")} /> : (
            <ul className="divide-y divide-border">
              {keys.data.map((k) => {
                const used = k.usedToday ?? 0, quota = k.dailyQuota ?? 0;
                const pct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;
                return (
                  <li key={k.id} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{k.name}</p>
                        <p className="text-xs text-muted-fg"><code className="font-mono">{k.prefix}…</code> · {k.createdAt ? t("created", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(k.createdAt)) }) : ""} · {k.lastUsedAt ? t("lastUsed", { time: relativeTime(k.lastUsedAt, locale) }) : t("neverUsed")}</p>
                      </div>
                      <Button variant="ghost" size="sm" className="text-down" onClick={() => void onRevoke(k)} disabled={revoke.isPending}><Trash2 aria-hidden className="size-4" />{t("revoke")}</Button>
                    </div>
                    {quota > 0 ? (
                      <div className="space-y-1">
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={quota} aria-valuenow={used} aria-label={t("usage", { used: number(used, locale), quota: number(quota, locale) })}>
                          <div className={cn("h-full rounded-full", pct >= 90 ? "bg-forecast" : "bg-brand")} style={{ width: `${pct}%` }} />
                        </div>
                        <p className="text-xs text-muted-fg">{t("usage", { used: number(used, locale), quota: number(quota, locale) })}</p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card className="h-fit space-y-4 lg:col-span-2">
          <CardTitle>{t("quickstart")}</CardTitle>
          <div className="space-y-1 text-sm"><p className="font-medium">{t("baseUrl")}</p>{base ? <code className="block break-all rounded-lg bg-muted px-2 py-1 font-mono text-xs">{base}</code> : <p className="text-muted-fg">{t("noBaseUrl")}</p>}</div>
          <p className="text-sm text-muted-fg">{t("headerNote")}</p>
          <pre className="overflow-x-auto rounded-xl bg-muted p-3 text-xs" tabIndex={0} aria-label={t("quickstart")}><code>{example}</code></pre>
          <div><p className="text-sm font-medium">{t("endpoints")}</p>
            <ul className="mt-1 space-y-1 text-sm">{ENDPOINTS.map((e) => <li key={e.path}><code className="font-mono text-xs">GET {e.path}?{e.query.replace("{cc}", cc)}</code><span className="block text-xs text-muted-fg">{t(e.key)}</span></li>)}</ul>
          </div>
        </Card>
      </div>

      <Dialog.Root open={secret != null} onOpenChange={(o) => { if (!o) setSecret(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content className="fixed start-1/2 top-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 space-y-3 rounded-2xl border border-border bg-card p-5 shadow-xl rtl:translate-x-1/2">
            <Dialog.Title className="text-lg font-semibold">{t("secretTitle")}</Dialog.Title>
            <Dialog.Description className="text-sm text-muted-fg">{t("secretBody")}</Dialog.Description>
            {secret?.secret ? <code className="block select-all break-all rounded-lg bg-muted p-3 font-mono text-sm" aria-label={secret.name}>{secret.secret}</code> : null}
            <div className="flex flex-wrap justify-end gap-2">
              {secret?.secret ? <Button variant="outline" size="sm" onClick={() => void copy(secret.secret!)}><Copy aria-hidden className="size-4" />{t("copy")}</Button> : null}
              <Dialog.Close asChild><Button size="sm">{t("done")}</Button></Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
