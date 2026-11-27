"use client";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Button, Input, Label } from "@/components/ui/primitives";
import { Link, useRouter } from "@/i18n/navigation";
import { bff } from "@/lib/auth/client";

/**
 * Two steps: request a code (always "sent", so emails can't be enumerated), then reset with code + new password.
 * People an admin added arrive here from their invitation with ?email= filled in, to set their first password.
 */
export default function ForgotPasswordPage() {
  return <Suspense><ForgotPassword /></Suspense>;
}

function ForgotPassword() {
  const t = useTranslations("auth");
  const invited = useSearchParams().get("email")?.slice(0, 254) ?? "";
  const [email, setEmail] = useState(invited);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const feedback = useFeedback();
  const problem = useProblemMessage();
  const router = useRouter();

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    await bff("forgot", { email });
    setSent(true);
  };
  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await bff("reset", { email, code, newPassword: password });
    if (r.ok) feedback.success(t("passwordUpdated"), { actionLabel: t("login"), onAction: () => router.push("/login") });
    else feedback.error(problem(r.problem));
  };

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">{sent ? t("resetTitle") : t("forgotTitle")}</h1><p className="mt-1 text-sm text-muted-fg">{sent ? t("verifyBody", { destination: email }) : t("forgotBody")}</p></div>
      {!sent ? (
        <form onSubmit={request} className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="email">{t("email")}</Label><Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <Button type="submit" className="w-full">{t("sendCode")}</Button>
        </form>
      ) : (
        <form onSubmit={reset} className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="code">Code</Label><Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required value={code} onChange={(e) => setCode(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="pw">{t("newPassword")}</Label><Input id="pw" type="password" minLength={10} required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <Button type="submit" className="w-full">{t("reset")}</Button>
        </form>
      )}
      <p className="text-center text-sm"><Link href="/login" className="text-brand hover:underline">← {t("login")}</Link></p>
    </div>
  );
}
