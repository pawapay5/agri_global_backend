"use client";
import { Laptop, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Badge, Button, Card, CardTitle, Input, Label } from "@/components/ui/primitives";
import { ApiError } from "@/lib/api/browser";
import { useDevices, useMe, useRevokeDevice, useTotpDisable, useTotpEnable, useTotpSetup } from "@/lib/api/queries";
import { bff } from "@/lib/auth/client";
import { relativeTime } from "@/lib/format";
import { PageTitle, QueryState } from "./common";

const CODE = /^\d{6}$/;

/** Settings → Security: TOTP two-step verification, signed-in devices, sign out everywhere. */
export function SecuritySettings() {
  const t = useTranslations("security");
  return (
    <div className="space-y-6">
      <PageTitle title={t("title")} />
      <TwoFactorCard />
      <DevicesCard />
      <SignOutAllCard />
    </div>
  );
}

function useFail() {
  const feedback = useFeedback();
  const tc = useTranslations("app");
  return (e: unknown) => feedback.error(e instanceof ApiError ? e.detail ?? e.code : tc("error"));
}

function TwoFactorCard() {
  const t = useTranslations("security");
  const feedback = useFeedback();
  const fail = useFail();
  const me = useMe();
  const setup = useTotpSetup(), enable = useTotpEnable(), disable = useTotpDisable();
  const [mode, setMode] = useState<"idle" | "setup" | "disable">("idle");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const on = me.data?.totpEnabled === true;

  // The QR is rendered on this device from the otpauth URL; the secret never goes to a third-party service.
  useEffect(() => {
    const url = setup.data?.otpauthUrl;
    if (!url) return;
    let live = true;
    QRCode.toString(url, { type: "svg", margin: 1, width: 192, errorCorrectionLevel: "M" }).then((svg) => { if (live) setQr(svg); }).catch(() => setQr(null));
    return () => { live = false; };
  }, [setup.data?.otpauthUrl]);

  const reset = () => { setMode("idle"); setCode(""); setCodeError(false); setQr(null); setup.reset(); };
  const start = () => setup.mutate(undefined, { onSuccess: () => setMode("setup"), onError: fail });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!CODE.test(code)) { setCodeError(true); return; }
    if (mode === "setup") enable.mutate(code, { onSuccess: (r) => { setRecovery(r.recoveryCodes); reset(); }, onError: fail });
    else disable.mutate(code, { onSuccess: () => { feedback.success(t("disabled")); reset(); }, onError: fail });
  };

  return (
    <Card className="space-y-4">
      <div className="flex items-start gap-3">
        {on ? <ShieldCheck aria-hidden className="size-6 text-up" /> : <ShieldOff aria-hidden className="size-6 text-muted-fg" />}
        <div className="flex-1">
          <CardTitle className="flex items-center gap-2">{t("twofaTitle")} {on ? <Badge tone="up">On</Badge> : <Badge>Off</Badge>}</CardTitle>
          <p className="mt-1 text-sm text-muted-fg">{on ? t("twofaOn") : t("twofaOff")}</p>
        </div>
        {mode === "idle" ? (on
          ? <Button variant="outline" onClick={() => setMode("disable")}>{t("disable")}</Button>
          : <Button onClick={start} disabled={setup.isPending}>{t("setUp")}</Button>) : null}
      </div>

      {recovery ? (
        <div className="space-y-3 rounded-xl border border-border bg-muted p-4" role="region" aria-label={t("recoveryTitle")}>
          <p className="font-semibold">{t("recoveryTitle")}</p>
          <p className="text-sm text-muted-fg">{t("recoveryBody")}</p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-4">{recovery.map((c) => <li key={c}>{c}</li>)}</ul>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { void navigator.clipboard?.writeText(recovery.join("\n")); feedback.success(t("copied")); }}>{t("copy")}</Button>
            <Button onClick={() => { setRecovery(null); feedback.success(t("enabled")); }}>{t("done")}</Button>
          </div>
        </div>
      ) : null}

      {mode !== "idle" ? (
        <form onSubmit={submit} noValidate className="space-y-4 border-t border-border pt-4">
          {mode === "setup" && setup.data ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              {/* SVG generated locally by the qrcode library from the backend's otpauth URL. */}
              {qr ? <div className="size-48 shrink-0 rounded-lg bg-white p-2" role="img" aria-label={t("scan")} dangerouslySetInnerHTML={{ __html: qr }} /> : <div className="size-48 animate-pulse rounded-lg bg-muted" />}
              <div className="space-y-2 text-sm">
                <p>{t("scan")}</p>
                <p className="text-muted-fg">{t("manual")}</p>
                <code className="block break-all rounded bg-muted px-2 py-1 font-mono">{setup.data.secret}</code>
              </div>
            </div>
          ) : <p className="text-sm text-muted-fg">{t("disableBody")}</p>}
          <div className="max-w-xs space-y-1.5">
            <Label htmlFor="totp-code">{t("code")}</Label>
            <Input id="totp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setCodeError(false); }}
              aria-invalid={codeError} aria-describedby={codeError ? "totp-err" : undefined} />
            {codeError ? <p id="totp-err" role="alert" className="text-xs text-down">{t("codeInvalid")}</p> : null}
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={enable.isPending || disable.isPending}>{mode === "setup" ? t("confirm") : t("disable")}</Button>
            <Button type="button" variant="ghost" onClick={reset}>{t("cancel")}</Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

function DevicesCard() {
  const t = useTranslations("security");
  const locale = useLocale();
  const feedback = useFeedback();
  const fail = useFail();
  const devices = useDevices();
  const revoke = useRevokeDevice();
  return (
    <Card>
      <CardTitle>{t("devicesTitle")}</CardTitle>
      <QueryState q={devices} empty={(d) => !d.length}>
        {(list) => (
          <ul className="mt-3 divide-y divide-border">
            {list.map((d) => {
              const Icon = d.platform === "web" ? Laptop : Smartphone;
              return (
                <li key={d.id} className="flex items-center gap-3 py-3">
                  <Icon aria-hidden className="size-5 text-muted-fg" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{d.name ?? d.platform}{d.current ? <Badge tone="brand" className="ms-2">{t("thisDevice")}</Badge> : null}</p>
                    <p className="text-xs text-muted-fg">{t("lastSeen", { time: relativeTime(d.lastSeenAt, locale) })}{d.appVersion ? ` · v${d.appVersion}` : ""}</p>
                  </div>
                  {!d.current ? (
                    <Button variant="outline" size="sm" disabled={revoke.isPending}
                      onClick={() => revoke.mutate(d.id, { onSuccess: () => feedback.success(t("revoked")), onError: fail })}>{t("revoke")}</Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </Card>
  );
}

function SignOutAllCard() {
  const t = useTranslations("security");
  const locale = useLocale();
  const feedback = useFeedback();
  const problem = useProblemMessage();
  const signOutAll = async () => {
    const ok = await feedback.confirm({ title: t("signOutAll"), description: t("signOutAllBody"), confirmLabel: t("signOutAllConfirm"), destructive: true });
    if (!ok) return;
    const r = await bff("logout-all");
    if (r.ok) window.location.assign(`/${locale}/login`); else feedback.error(problem(r.problem.code));
  };
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div><CardTitle>{t("signOutAll")}</CardTitle><p className="mt-1 text-sm text-muted-fg">{t("signOutAllBody")}</p></div>
      <Button variant="outline" className="text-down" onClick={signOutAll}>{t("signOutAll")}</Button>
    </Card>
  );
}
