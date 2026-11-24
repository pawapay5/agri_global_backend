"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { SocialSignIn } from "@/components/auth/social";
import { Button, FieldError, Input, Label } from "@/components/ui/primitives";
import { Link, useRouter } from "@/i18n/navigation";
import { bff } from "@/lib/auth/client";

const schema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.email().max(254),
  password: z.string().min(10, "At least 10 characters").max(128),
  country: z.string().regex(/^[A-Z]{2}$/),
  acceptTerms: z.literal(true, { message: "Required" }),
});
type Values = z.infer<typeof schema>;

export function SignupForm({ countries }: { countries: { iso2: string; name: string }[] }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const f = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { country: countries[0]?.iso2 ?? "GH" } as Partial<Values> });
  const countryValue = useWatch({ control: f.control, name: "country" });
  const feedback = useFeedback();
  const problem = useProblemMessage();
  const err = (code: string) => feedback.error(problem(code));

  const onSubmit = f.handleSubmit(async (v) => {
    const r = await bff("register", { ...v, locale });
    if (!r.ok) return err(r.problem.code);
    // The backend has emailed a verification code; confirm it before entering the app.
    router.replace({ pathname: "/verify", query: { email: v.email } });
  });

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">{t("signupTitle")}</h1><p className="mt-1 text-sm text-muted-fg">{t("signupSubtitle")}</p></div>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5"><Label htmlFor="fullName">{t("fullName")}</Label><Input id="fullName" autoComplete="name" {...f.register("fullName")} /><FieldError>{f.formState.errors.fullName?.message}</FieldError></div>
        <div className="space-y-1.5"><Label htmlFor="email">{t("email")}</Label><Input id="email" type="email" autoComplete="email" {...f.register("email")} /><FieldError>{f.formState.errors.email?.message}</FieldError></div>
        <div className="space-y-1.5"><Label htmlFor="password">{t("password")}</Label><Input id="password" type="password" autoComplete="new-password" {...f.register("password")} /><FieldError>{f.formState.errors.password?.message}</FieldError></div>
        <div className="space-y-1.5">
          <Label htmlFor="country">{t("country")}</Label>
          <select id="country" className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" {...f.register("country")}>
            {countries.map((c) => <option key={c.iso2} value={c.iso2}>{c.name}</option>)}
          </select>
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-[var(--brand)]" {...f.register("acceptTerms")} />{t("terms")}</label>
        <FieldError>{f.formState.errors.acceptTerms?.message}</FieldError>
        <Button type="submit" className="w-full" disabled={f.formState.isSubmitting}>{t("signup")}</Button>
      </form>
      <p className="text-center text-xs uppercase tracking-wide text-muted-fg">{t("or")}</p>
      <SocialSignIn country={countryValue ?? "GH"} onResult={() => window.location.assign(`/${locale}/app`)} onError={err} />
      <p className="text-center text-sm">{t("haveAccount")} <Link href="/login" className="font-semibold text-brand hover:underline">{t("login")}</Link></p>
    </div>
  );
}
