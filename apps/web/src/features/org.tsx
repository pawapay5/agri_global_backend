"use client";
import { Building2, LogOut, Mail, Trash2, UserPlus, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsString, useQueryState } from "nuqs";
import { useState } from "react";
import { EmptyState } from "@/components/agri/empty-state";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Badge, Button, buttonVariants, Card, CardTitle, FieldError, Input, Label, Skeleton } from "@/components/ui/primitives";
import { Link, useRouter } from "@/i18n/navigation";
import { ApiError, type S } from "@/lib/api/browser";
import { useAcceptInvite, useInvite, useOrg, useOrgInvites, useOrgMembers, useRemoveMember, useRenameOrg, useRevokeInvite, useSetMemberRole } from "@/lib/api/org";
import { useMe } from "@/lib/api/queries";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageTitle } from "./common";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Seat use as a 0–100 share; full when used + pending ≥ max (exported for tests). */
export function seatState(s: { used: number; max: number; pendingInvites?: number }) {
  const taken = s.used + (s.pendingInvites ?? 0);
  return { pct: s.max > 0 ? Math.min(100, Math.round((s.used / s.max) * 100)) : 100, full: s.max > 0 ? taken >= s.max : true };
}

/** /app/org (no mockup): organisation details, seats, members and roles, invitations. */
export function OrgPage() {
  const t = useTranslations("org");
  const org = useOrg();
  if (org.isPending) return <Skeleton className="h-96" />;
  if (org.error instanceof ApiError && org.error.status === 404) {
    return <EmptyState icon={Building2} title={t("none")} description={t("noneBody")} action={<Link href="/app/billing" className={buttonVariants()}>{t("seePlans")}</Link>} />;
  }
  if (!org.data) return <Card role="alert" className="text-sm">{t("none")}</Card>;
  const o = org.data;
  const admin = o.myRole === "admin";
  return (
    <div className="space-y-6">
      <PageTitle title={o.name} subtitle={t("intro")} />
      <Summary o={o} admin={admin} />
      <Members o={o} admin={admin} />
      {admin ? <Invites o={o} /> : <p className="text-sm text-muted-fg">{t("adminOnly")}</p>}
    </div>
  );
}

function Summary({ o, admin }: { o: S["Organisation"]; admin: boolean }) {
  const t = useTranslations("org");
  const rename = useRenameOrg();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [name, setName] = useState(o.name);
  const [bad, setBad] = useState(false);
  const seats = seatState(o.seats);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const v = name.trim();
    if (v.length < 2 || v.length > 120) { setBad(true); return; }
    setBad(false);
    rename.mutate(v, { onSuccess: () => fb.success(t("renamed")), onError: (x) => fb.error(problem(x as never)) });
  };
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="space-y-3">
        {admin ? (
          <form onSubmit={save} noValidate className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1 space-y-1"><Label htmlFor="org-name">{t("name")}</Label><Input id="org-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-invalid={bad} aria-describedby={bad ? "org-name-err" : undefined} /></div>
            <Button type="submit" size="sm" disabled={rename.isPending || name.trim() === o.name}>{t("rename")}</Button>
            <FieldError><span id="org-name-err">{bad ? t("nameBad") : null}</span></FieldError>
          </form>
        ) : <p className="text-lg font-semibold">{o.name}</p>}
        <p className="text-sm text-muted-fg">{t("type")}: {t(`type_${o.type}`)}{o.country ? ` · ${o.country}` : ""}</p>
      </Card>
      <Card className="space-y-2">
        <CardTitle className="text-base">{t("seats")}</CardTitle>
        <p className="text-sm">{t("seatsUsed", { used: o.seats.used, max: o.seats.max })}</p>
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={o.seats.max} aria-valuenow={o.seats.used} aria-label={t("seats")}>
          <div className={cn("h-full rounded-full", seats.full ? "bg-forecast" : "bg-brand")} style={{ width: `${seats.pct}%` }} />
        </div>
        {o.seats.pendingInvites ? <p className="text-xs text-muted-fg">{t("pending", { n: o.seats.pendingInvites })}</p> : null}
        {admin && seats.full ? <p className="text-xs text-forecast-ink">{t("seatsFull")}</p> : null}
      </Card>
    </div>
  );
}

function Members({ o, admin }: { o: S["Organisation"]; admin: boolean }) {
  const t = useTranslations("org");
  const locale = useLocale();
  const router = useRouter();
  const me = useMe();
  const members = useOrgMembers();
  const setRole = useSetMemberRole();
  const remove = useRemoveMember();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const date = (d: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(d));

  const onRemove = async (m: S["OrgMember"]) => {
    const self = m.userId === me.data?.id;
    const name = m.name || m.email || "";
    const ok = await fb.confirm(self
      ? { title: t("leaveTitle", { org: o.name }), description: t("leaveBody"), confirmLabel: t("leave"), destructive: true }
      : { title: t("removeTitle", { name }), description: t("removeBody"), confirmLabel: t("remove"), destructive: true });
    if (!ok) return;
    remove.mutate(m.userId, { onSuccess: () => { fb.success(self ? t("left") : t("removed")); if (self) router.push("/app"); }, onError: (x) => fb.error(problem(x as never)) });
  };

  return (
    <Card className="space-y-3 p-0">
      <CardTitle className="px-5 pt-5">{t("members")}</CardTitle>
      {members.isPending ? <Skeleton className="m-5 h-40" /> : !members.data?.length ? <EmptyState icon={Users} title={t("members")} /> : (
        <ul className="divide-y divide-border">
          {members.data.map((m) => {
            const self = m.userId === me.data?.id;
            const name = m.name || m.email || "—";
            return (
              <li key={m.userId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{name}{self ? <Badge className="ms-2">{t("you")}</Badge> : null}</p>
                  <p className="text-xs text-muted-fg">{m.email && m.name ? `${m.email} · ` : ""}{t("joined", { date: date(m.joinedAt) })}{m.lastActiveAt ? ` · ${t("lastActive", { time: relativeTime(m.lastActiveAt, locale) })}` : ""}</p>
                </div>
                {admin ? (
                  <label className="text-sm"><span className="sr-only">{t("changeRole", { name })}</span>
                    <select value={m.role} onChange={(e) => setRole.mutate({ userId: m.userId, role: e.target.value as S["OrgRole"] }, { onSuccess: () => fb.success(t("roleChanged")), onError: (x) => fb.error(problem(x as never)) })}
                      disabled={setRole.isPending} className="h-9 rounded-xl border border-border bg-background px-2 text-sm">
                      <option value="admin">{t("role_admin")}</option><option value="member">{t("role_member")}</option>
                    </select>
                  </label>
                ) : <Badge tone={m.role === "admin" ? "brand" : "neutral"}>{t(`role_${m.role}`)}</Badge>}
                {admin || self ? (
                  <button type="button" onClick={() => void onRemove(m)} disabled={remove.isPending} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-down hover:bg-down/10" aria-label={self ? t("leave") : `${t("remove")}: ${name}`}>
                    {self ? <LogOut aria-hidden className="size-4" /> : <Trash2 aria-hidden className="size-4" />}<span className="hidden sm:inline">{self ? t("leave") : t("remove")}</span>
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Invites({ o }: { o: S["Organisation"] }) {
  const t = useTranslations("org");
  const locale = useLocale();
  const invites = useOrgInvites();
  const invite = useInvite();
  const revoke = useRevokeInvite();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<S["OrgRole"]>("member");
  const [bad, setBad] = useState(false);
  const full = seatState(o.seats).full;
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!EMAIL.test(v) || v.length > 254) { setBad(true); document.getElementById("inv-email")?.focus(); return; }
    setBad(false);
    invite.mutate({ email: v, role }, { onSuccess: () => { setEmail(""); fb.success(t("invited", { email: v })); }, onError: (x) => fb.error(problem(x as never)) });
  };
  return (
    <Card className="space-y-4">
      <CardTitle>{t("invites")}</CardTitle>
      <form onSubmit={send} noValidate className="flex flex-wrap items-end gap-3">
        <div className="min-w-60 flex-1 space-y-1"><Label htmlFor="inv-email">{t("email")}</Label><Input id="inv-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={bad} aria-describedby={bad ? "inv-email-err" : undefined} /></div>
        <div className="space-y-1"><Label htmlFor="inv-role">{t("role")}</Label>
          <select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as S["OrgRole"])} className="h-10 rounded-xl border border-border bg-background px-3 text-sm"><option value="member">{t("role_member")}</option><option value="admin">{t("role_admin")}</option></select>
        </div>
        <Button type="submit" disabled={invite.isPending || full}><UserPlus aria-hidden className="size-4" />{t("invite")}</Button>
        <FieldError><span id="inv-email-err">{bad ? t("emailBad") : null}</span></FieldError>
      </form>
      {full ? <p className="text-sm text-forecast-ink">{t("seatsFull")}</p> : null}
      {invites.isPending ? <Skeleton className="h-24" /> : !invites.data?.length ? <p className="text-sm text-muted-fg">{t("noInvites")}</p> : (
        <ul className="divide-y divide-border text-sm">
          {invites.data.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 py-2">
              <Mail aria-hidden className="size-4 text-muted-fg" />
              <span className="min-w-0 flex-1"><span className="font-medium">{i.email}</span> <Badge className="ms-1">{t(`role_${i.role}`)}</Badge><span className="block text-xs text-muted-fg">{t("expires", { time: relativeTime(i.expiresAt, locale) })}</span></span>
              <Button variant="ghost" size="sm" onClick={() => revoke.mutate(i.id, { onSuccess: () => fb.success(t("revoked")), onError: (x) => fb.error(problem(x as never)) })} disabled={revoke.isPending}>{t("revoke")}</Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** /app/org/join?token=: joining needs a click, so following a link alone never changes someone's organisation. */
export function JoinOrg() {
  const t = useTranslations("org");
  const [token] = useQueryState("token", parseAsString);
  const accept = useAcceptInvite();
  const fb = useFeedback();
  const valid = Boolean(token && /^[A-Za-z0-9_-]{16,128}$/.test(token));
  return (
    <div className="mx-auto max-w-md space-y-4">
      <PageTitle title={t("joinTitle")} />
      {!valid ? <Card role="alert" className="text-sm">{t("noToken")}</Card> : accept.isSuccess ? (
        <Card className="space-y-3"><p>{t("joinedOk", { org: accept.data?.name ?? "" })}</p><Link href="/app/org" className={buttonVariants({ size: "sm" })}>{t("goOrg")}</Link></Card>
      ) : (
        <Card className="space-y-3">
          {accept.isError ? <p role="alert" className="text-sm text-down">{t("joinFailed")}</p> : null}
          <Button onClick={() => accept.mutate(token!, { onSuccess: (o) => fb.success(t("joinedOk", { org: o?.name ?? "" })) })} disabled={accept.isPending}><Building2 aria-hidden className="size-4" />{accept.isPending ? t("joining") : t("joinTitle")}</Button>
        </Card>
      )}
    </div>
  );
}
