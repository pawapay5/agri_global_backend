"use client";
import { Search, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useState } from "react";
import { EmptyState } from "@/components/agri/empty-state";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Badge, Button, Card, FieldError, Input, Label, Skeleton } from "@/components/ui/primitives";
import type { S } from "@/lib/api/browser";
import { field, useAdminUsers, useCountries, useUpdateCountry, useUpdateUser, type Row } from "@/lib/api/admin";
import { useMe } from "@/lib/api/queries";
import { relativeTime } from "@/lib/format";
import { cn, pick } from "@/lib/utils";

const ROLES: S["Role"][] = ["farmer", "trader", "consumer", "researcher", "student", "policymaker", "enumerator", "agronomist", "org_admin", "admin"];
export const STAFF = new Set<S["Role"]>(["enumerator", "agronomist", "org_admin", "admin"]);

/** /admin/countries: each country pack's settings; deactivating is confirmed. */
export function CountryPacks() {
  const t = useTranslations("adm");
  const locale = useLocale();
  const countries = useCountries();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t("countries")}</h1>
      {countries.isPending ? <Skeleton className="h-64" /> : !countries.data?.length ? <EmptyState title={t("noRows")} /> : (
        <ul className="space-y-3">
          {countries.data.map((c) => (
            <li key={c.iso2}><Card className="space-y-3">
              <button type="button" onClick={() => setOpen(open === c.iso2 ? null : c.iso2)} aria-expanded={open === c.iso2} className="flex w-full flex-wrap items-center gap-3 text-start">
                <span className="font-mono text-sm text-muted-fg">{c.iso2}</span>
                <span className="flex-1 font-semibold">{pick(c.name, locale) || c.iso2}{c.brandName ? <span className="ms-2 text-sm font-normal text-muted-fg">{c.brandName}</span> : null}</span>
                <Badge tone={c.active ? "up" : "neutral"}>{c.active ? t("active") : "—"}</Badge>
                <span className="text-sm text-muted-fg">{c.currency} · {c.defaultUnit}</span>
              </button>
              {open === c.iso2 ? <CountryForm c={c} /> : null}
            </Card></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CountryForm({ c }: { c: S["Country"] }) {
  const t = useTranslations("adm");
  const locale = useLocale();
  const save = useUpdateCountry();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [v, setV] = useState({ brandName: c.brandName ?? "", currency: c.currency, defaultLocale: c.defaultLocale, locales: (c.locales ?? []).join(", "), defaultUnit: c.defaultUnit, areaUnit: c.areaUnit ?? "", timezone: c.timezone, active: c.active });
  const [bad, setBad] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[A-Z]{3}$/.test(v.currency) || !v.defaultUnit.trim() || !v.timezone.trim()) { setBad(true); return; }
    setBad(false);
    if (c.active && !v.active && !(await fb.confirm({ title: t("deactivateTitle", { country: pick(c.name, locale) || c.iso2 }), description: t("deactivateBody"), confirmLabel: t("save"), destructive: true }))) return;
    const locales = v.locales.split(",").map((x) => x.trim()).filter(Boolean);
    save.mutate({ iso2: c.iso2, body: { brandName: v.brandName.trim() || undefined, currency: v.currency, defaultLocale: v.defaultLocale.trim(), locales, defaultUnit: v.defaultUnit.trim(), areaUnit: v.areaUnit.trim() || undefined, timezone: v.timezone.trim(), active: v.active } }, {
      onSuccess: () => fb.success(t("countrySaved")), onError: (x) => fb.error(problem(x as never)),
    });
  };
  const input = (k: keyof typeof v, label: string, extra: Partial<React.ComponentProps<"input">> = {}) => (
    <div className="space-y-1"><Label htmlFor={`cp-${c.iso2}-${k}`}>{label}</Label><Input id={`cp-${c.iso2}-${k}`} value={String(v[k])} onChange={(e) => setV({ ...v, [k]: e.target.value })} {...extra} /></div>
  );
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
      {input("brandName", t("brandName"), { maxLength: 60 })}
      {input("currency", t("currency"), { maxLength: 3 })}
      {input("defaultLocale", t("defaultLocale"), { maxLength: 10 })}
      {input("locales", t("locales"))}
      {input("defaultUnit", t("defaultUnit"), { maxLength: 32 })}
      {input("areaUnit", t("areaUnit"), { maxLength: 16 })}
      {input("timezone", t("timezone"), { maxLength: 64 })}
      <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} className="size-4 accent-brand" />{t("active")}</label>
      <div className="sm:col-span-2 lg:col-span-4"><FieldError>{bad ? t("countryBad") : null}</FieldError><Button type="submit" size="sm" disabled={save.isPending}>{t("save")}</Button></div>
    </form>
  );
}

/** /admin/users: search and filter; role changes to staff roles and suspensions are confirmed (and audited). */
export function AdminUsers() {
  const t = useTranslations("adm");
  const locale = useLocale();
  const me = useMe();
  const countries = useCountries();
  const [f, setF] = useQueryStates({ q: parseAsString.withDefault(""), role: parseAsStringLiteral(ROLES), country: parseAsString });
  const [q, setQ] = useState(f.q);
  const users = useAdminUsers({ q: f.q, role: f.role ?? undefined, country: f.country ?? undefined });
  const rows = (users.data?.pages.flatMap((p) => p.data) ?? []) as Row[];
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t("users")}</h1>
      <div className="flex flex-wrap items-end gap-3">
        <form role="search" onSubmit={(e) => { e.preventDefault(); void setF({ q: q.trim() || null }); }} className="relative min-w-60 flex-1">
          <label htmlFor="u-q" className="sr-only">{t("search")}</label>
          <Search aria-hidden className="absolute start-3 top-2.5 size-5 text-muted-fg" />
          <Input id="u-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="ps-10" maxLength={100} />
        </form>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-fg">{t("role")}
          <select value={f.role ?? ""} onChange={(e) => void setF({ role: (e.target.value || null) as S["Role"] | null })} className="h-10 rounded-xl border border-border bg-background px-2 text-sm text-foreground"><option value="">{t("allRoles")}</option>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-fg">{t("country")}
          <select value={f.country ?? ""} onChange={(e) => void setF({ country: e.target.value || null })} className="h-10 rounded-xl border border-border bg-background px-2 text-sm text-foreground"><option value="">{t("allCountries")}</option>{(countries.data ?? []).map((c) => <option key={c.iso2} value={c.iso2}>{c.iso2}</option>)}</select>
        </label>
      </div>
      {users.isPending ? <Skeleton className="h-96" /> : !rows.length ? <EmptyState icon={Users} title={t("noRows")} /> : (
        <Card className="p-0">
          <ul className="divide-y divide-border">{rows.map((u) => <li key={String(field(u, "id"))}><UserRow u={u} self={field(u, "id") === me.data?.id} locale={locale} /></li>)}</ul>
          {users.hasNextPage ? <div className="border-t border-border p-3"><Button variant="outline" size="sm" onClick={() => void users.fetchNextPage()}>{t("loadMore")}</Button></div> : null}
        </Card>
      )}
    </div>
  );
}

function UserRow({ u, self, locale }: { u: Row; self: boolean; locale: string }) {
  const t = useTranslations("adm");
  const update = useUpdateUser();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [reason, setReason] = useState("");
  const [suspending, setSuspending] = useState(false);
  const [bad, setBad] = useState(false);
  const id = String(field(u, "id"));
  const name = String(field(u, "fullName") ?? field(u, "email") ?? field(u, "phone") ?? id.slice(0, 8));
  const role = field<S["Role"]>(u, "role");
  const suspended = Boolean(field(u, "suspendedAt") ?? field(u, "suspended"));
  const created = field<string>(u, "createdAt"), last = field<string>(u, "lastLoginAt");

  const changeRole = async (next: S["Role"]) => {
    if (STAFF.has(next) && !(await fb.confirm({ title: t("roleTitle", { name, role: next }), description: t("roleBody"), confirmLabel: t("save"), destructive: true }))) return;
    update.mutate({ id, body: { role: next } }, { onSuccess: () => fb.success(t("roleChanged")), onError: (x) => fb.error(problem(x as never)) });
  };
  const toggleSuspend = async () => {
    if (!suspended) {
      if (!reason.trim()) { setBad(true); document.getElementById(`sr-${id}`)?.focus(); return; }
      if (!(await fb.confirm({ title: t("suspendTitle", { name }), description: t("suspendBody"), confirmLabel: t("suspend"), destructive: true }))) return;
    }
    setBad(false);
    update.mutate({ id, body: { suspended: !suspended, ...(reason.trim() ? { reason: reason.trim().slice(0, 500) } : {}) } }, {
      onSuccess: () => { setSuspending(false); setReason(""); fb.success(t(suspended ? "userReinstated" : "userSuspended")); }, onError: (x) => fb.error(problem(x as never)),
    });
  };

  return (
    <div className={cn("space-y-2 px-4 py-3", suspended && "bg-down/5")}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{name}{suspended ? <Badge tone="down" className="ms-2">{t("suspended")}</Badge> : null}</p>
          <p className="text-xs text-muted-fg">{[field(u, "email"), field(u, "phone"), field(u, "countryIso2")].filter(Boolean).join(" · ")}{created ? ` · ${t("joined")} ${relativeTime(created, locale)}` : ""} · {t("lastLogin")}: {last ? relativeTime(last, locale) : t("never")}</p>
        </div>
        <label className="text-sm"><span className="sr-only">{t("role")}: {name}</span>
          <select value={role ?? ""} disabled={self || update.isPending} onChange={(e) => void changeRole(e.target.value as S["Role"])} className="h-9 rounded-xl border border-border bg-background px-2 text-sm">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        {!self ? (suspended
          ? <Button variant="outline" size="sm" onClick={() => void toggleSuspend()} disabled={update.isPending}>{t("unsuspend")}</Button>
          : <Button variant="ghost" size="sm" className="text-down" onClick={() => setSuspending((s) => !s)} aria-expanded={suspending}>{t("suspend")}…</Button>) : null}
      </div>
      {suspending && !suspended ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1 space-y-1"><Label htmlFor={`sr-${id}`}>{t("reason")}</Label><Input id={`sr-${id}`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} aria-invalid={bad} /></div>
          <Button size="sm" className="bg-down text-white hover:bg-down/90" onClick={() => void toggleSuspend()} disabled={update.isPending}>{t("suspend")}</Button>
          <FieldError>{bad ? t("reasonRequired") : null}</FieldError>
        </div>
      ) : null}
    </div>
  );
}

