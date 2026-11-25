"use client";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Button } from "@/components/ui/primitives";
import { bff } from "@/lib/auth/client";

const LEN = 6;

/** 6-box OTP entry (paste-friendly), 30 s resend cooldown mirrored from the backend. */
export function VerifyForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const email = useSearchParams().get("email") ?? "";
  const [digits, setDigits] = useState<string[]>(Array(LEN).fill(""));
  const [cooldown, setCooldown] = useState(30);
  const feedback = useFeedback();
  const problem = useProblemMessage();
  const [busy, setBusy] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const set = (i: number, v: string) => {
    const chars = v.replace(/\D/g, "").split("");
    if (!chars.length) { setDigits((d) => d.map((x, j) => (j === i ? "" : x))); return; }
    setDigits((d) => { const n = [...d]; chars.forEach((c, k) => { if (i + k < LEN) n[i + k] = c; }); return n; });
    refs.current[Math.min(i + chars.length, LEN - 1)]?.focus();
  };

  const submit = async () => {
    setBusy(true);
    const r = await bff("otp-verify", { channel: "email", destination: email, purpose: "verify_email", code: digits.join("") });
    setBusy(false);
    // New accounts go through first-run setup; it can be skipped.
    if (r.ok) window.location.assign(`/${locale}/app/onboarding`);
    else feedback.error(problem(r.problem.code));
  };

  const resend = async () => {
    const r = await bff("otp-request", { channel: "email", destination: email, purpose: "verify_email", locale });
    setCooldown(r.ok ? 30 : r.problem.retryAfterSeconds ?? 30);
    if (r.ok) feedback.success(t("codeResent"));
    else feedback.error(problem(r.problem.code));
  };

  return (
    <div className="space-y-6 text-center">
      <div><h1 className="text-2xl font-bold">{t("verifyTitle")}</h1><p className="mt-1 text-sm text-muted-fg">{t("verifyBody", { destination: email })}</p></div>
      <fieldset className="flex justify-center gap-2" aria-label="Verification code">
        {digits.map((d, i) => (
          <input key={i} ref={(el) => { refs.current[i] = el; }} value={d} inputMode="numeric" autoComplete={i === 0 ? "one-time-code" : "off"} maxLength={LEN}
            aria-label={`Digit ${i + 1}`} onChange={(e) => set(i, e.target.value)}
            onKeyDown={(e) => { if (e.key === "Backspace" && !d && i > 0) refs.current[i - 1]?.focus(); }}
            className="size-12 rounded-xl border border-border bg-background text-center text-xl font-semibold focus-visible:ring-2 focus-visible:ring-ring" />
        ))}
      </fieldset>
      <p className="text-sm text-muted-fg">
        {cooldown > 0 ? t("resendIn", { seconds: cooldown }) : <button type="button" onClick={resend} className="font-semibold text-brand hover:underline">{t("resend")}</button>}
      </p>
      <Button className="w-full" onClick={submit} disabled={busy || digits.some((x) => !x)}>{t("verify")}</Button>
    </div>
  );
}
