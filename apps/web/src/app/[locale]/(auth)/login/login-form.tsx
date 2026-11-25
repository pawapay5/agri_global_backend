"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "@/lib/zod";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { SocialSignIn } from "@/components/auth/social";
import { Button, FieldError, Input, Label } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { bff, safeNext } from "@/lib/auth/client";

const emailSchema = z.object({ email: z.email(), password: z.string().min(1).max(128) });
const phoneSchema = z.object({ phone: z.string().regex(/^\+[1-9]\d{6,14}$/, "Use international format, e.g. +233241234567") });
const codeSchema = z.object({ code: z.string().trim().min(6).max(32) });

type Step = "email" | "phone" | "phone-code" | "mfa";

export function LoginForm({ defaultCountry }: { defaultCountry: string }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const next = safeNext(useSearchParams().get("next"), locale);
  const [step, setStep] = useState<Step>("email");
  const [phone, setPhone] = useState("");
  const feedback = useFeedback();
  const problem = useProblemMessage();
  const err = (code: string) => feedback.error(problem(code));
  // Phone or social sign-in can create the account: new users go through first-run setup.
  const done = (status: string, isNewUser = false) =>
    status === "mfa_required" ? setStep("mfa") : window.location.assign(isNewUser ? `/${locale}/app/onboarding` : next);

  const emailForm = useForm({ resolver: zodResolver(emailSchema) });
  const phoneForm = useForm({ resolver: zodResolver(phoneSchema) });
  const codeForm = useForm({ resolver: zodResolver(codeSchema) });

  const onEmail = emailForm.handleSubmit(async (v) => {
    const r = await bff("login", v);
    if (r.ok) done(r.data.status, r.data.isNewUser); else err(r.problem.code);
  });
  const onPhone = phoneForm.handleSubmit(async (v) => {
    const r = await bff("otp-request", { channel: "sms", destination: v.phone, purpose: "login", locale });
    if (r.ok) { setPhone(v.phone); setStep("phone-code"); } else err(r.problem.code);
  });
  const onCode = codeForm.handleSubmit(async (v) => {
    const r = step === "mfa"
      ? await bff("mfa", { code: v.code })
      : await bff("otp-verify", { channel: "sms", destination: phone, purpose: "login", code: v.code });
    if (r.ok) done(r.data.status, r.data.isNewUser); else err(r.problem.code);
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{step === "mfa" ? t("mfaTitle") : t("loginTitle")}</h1>
        <p className="mt-1 text-sm text-muted-fg">{step === "mfa" ? t("mfaBody") : step === "phone-code" ? t("verifyBody", { destination: phone }) : t("loginSubtitle")}</p>
      </div>

      {step === "email" && (
        <form onSubmit={onEmail} className="space-y-4" noValidate>
          <div className="space-y-1.5"><Label htmlFor="email">{t("email")}</Label><Input id="email" type="email" autoComplete="email" {...emailForm.register("email")} aria-invalid={!!emailForm.formState.errors.email} /><FieldError>{emailForm.formState.errors.email?.message}</FieldError></div>
          <div className="space-y-1.5">
            <div className="flex justify-between"><Label htmlFor="password">{t("password")}</Label><Link href="/forgot-password" className="text-sm text-brand hover:underline">{t("forgot")}</Link></div>
            <Input id="password" type="password" autoComplete="current-password" {...emailForm.register("password")} />
          </div>
          <Button type="submit" className="w-full" disabled={emailForm.formState.isSubmitting}>{t("login")}</Button>
          <button type="button" className="w-full text-sm text-brand hover:underline" onClick={() => setStep("phone")}>{t("phoneLogin")}</button>
        </form>
      )}

      {step === "phone" && (
        <form onSubmit={onPhone} className="space-y-4" noValidate>
          <div className="space-y-1.5"><Label htmlFor="phone">{t("phone")}</Label><Input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+233…" {...phoneForm.register("phone")} /><FieldError>{phoneForm.formState.errors.phone?.message}</FieldError></div>
          <Button type="submit" className="w-full" disabled={phoneForm.formState.isSubmitting}>{t("sendOtp")}</Button>
        </form>
      )}

      {(step === "phone-code" || step === "mfa") && (
        <form onSubmit={onCode} className="space-y-4" noValidate>
          <Input aria-label="Code" inputMode={step === "mfa" ? "text" : "numeric"} autoComplete="one-time-code" className="text-center text-2xl tracking-[0.5em]" maxLength={step === "mfa" ? 32 : 6} {...codeForm.register("code")} autoFocus />
          <Button type="submit" className="w-full" disabled={codeForm.formState.isSubmitting}>{t("verify")}</Button>
        </form>
      )}

      {step !== "mfa" && (
        <>
          <p className="text-center text-xs uppercase tracking-wide text-muted-fg">{t("or")}</p>
          <SocialSignIn country={defaultCountry} onResult={done} onError={err} />
          <p className="text-center text-sm">{t("noAccount")} <Link href="/signup" className="font-semibold text-brand hover:underline">{t("signup")}</Link></p>
        </>
      )}
    </div>
  );
}
