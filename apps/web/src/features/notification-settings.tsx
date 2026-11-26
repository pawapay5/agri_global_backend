"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ALERT_CHANNELS } from "@/components/agri/alert-form";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Button, Card, CardTitle, FieldError, Input, Label, Skeleton } from "@/components/ui/primitives";
import type { S } from "@/lib/api/browser";
import { useNotificationPrefs, useSaveNotificationPrefs } from "@/lib/api/queries";
import { PageTitle, QueryState } from "./common";
import { CATEGORIES } from "./notifications";

type Prefs = S["NotificationPreferences"];
type Channel = (typeof ALERT_CHANNELS)[number];
const OPTIONAL: Channel[] = ALERT_CHANNELS.filter((c) => c !== "in_app");

/** E.164-ish: a "+", then 8–15 digits once spaces and dashes are removed (exported for tests). */
export function normalisePhone(v: string): string | null {
  const s = v.replace(/[\s\-().]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

/** /app/settings/notifications (mockup: Notification settings). In-app is always on; the rest is per category. */
export function NotificationSettings() {
  const t = useTranslations("alr");
  const prefs = useNotificationPrefs();
  return (
    <div className="max-w-3xl space-y-6">
      <PageTitle title={t("prefsTitle")} subtitle={t("prefsIntro")} />
      <QueryState q={prefs} skeleton={<Skeleton className="h-96" />}>{(p) => <PrefsForm initial={p} />}</QueryState>
    </div>
  );
}

function PrefsForm({ initial }: { initial: Prefs }) {
  const t = useTranslations("alr");
  const td = useTranslations("dash");
  const tds = useTranslations("ds");
  const fb = useFeedback();
  const problem = useProblemMessage();
  const save = useSaveNotificationPrefs();
  const [cats, setCats] = useState<Record<string, Channel[]>>(() => Object.fromEntries(CATEGORIES.map((c) => [c, (initial.categories?.[c] ?? []) as Channel[]])));
  const [quiet, setQuiet] = useState(Boolean(initial.quietHours));
  const [start, setStart] = useState(initial.quietHours?.start ?? "21:00");
  const [end, setEnd] = useState(initial.quietHours?.end ?? "06:00");
  const [phone, setPhone] = useState(initial.whatsappNumber ?? "");
  const [phoneError, setPhoneError] = useState(false);
  const tz = initial.quietHours?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const usesWhatsapp = Object.values(cats).some((cs) => cs.includes("whatsapp"));

  const flip = (cat: string, ch: Channel) => setCats((s) => ({ ...s, [cat]: s[cat]!.includes(ch) ? s[cat]!.filter((x) => x !== ch) : [...s[cat]!, ch] }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const normalised = phone.trim() ? normalisePhone(phone) : null;
    if (phone.trim() && !normalised) { setPhoneError(true); document.getElementById("wa")?.focus(); return; }
    setPhoneError(false);
    const body: Prefs = {
      categories: Object.fromEntries(Object.entries(cats).map(([c, chs]) => [c, ["in_app", ...chs.filter((x) => x !== "in_app")]])) as Prefs["categories"],
      quietHours: quiet ? { start, end, timezone: tz } : null,
      whatsappNumber: normalised,
    };
    save.mutate(body, { onSuccess: () => fb.success(t("saved")), onError: (err) => fb.error(problem(err as never)) });
  };

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <Card className="overflow-x-auto p-0" tabIndex={0} role="region" aria-label={t("prefsTitle")}>
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="sr-only">{t("prefsTitle")}</caption>
          <thead className="bg-muted text-muted-fg">
            <tr><th scope="col" className="px-4 py-2 text-start font-medium">{t("category")}</th>{ALERT_CHANNELS.map((c) => <th key={c} scope="col" className="px-3 py-2 text-center font-medium">{tds(`ch_${c}`)}</th>)}</tr>
          </thead>
          <tbody>
            {CATEGORIES.map((cat) => (
              <tr key={cat} className="border-t border-border">
                <th scope="row" className="px-4 py-3 text-start font-medium">{td(`cat_${cat}`)}</th>
                {ALERT_CHANNELS.map((ch) => (
                  <td key={ch} className="px-3 py-3 text-center">
                    <input type="checkbox" className="size-4 accent-[var(--brand)] disabled:opacity-60" aria-label={`${td(`cat_${cat}`)}: ${tds(`ch_${ch}`)}`}
                      checked={ch === "in_app" || cats[cat]!.includes(ch)} disabled={ch === "in_app"} onChange={() => OPTIONAL.includes(ch) && flip(cat, ch)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="space-y-4">
        <CardTitle>{t("quietHours")}</CardTitle>
        <p className="text-sm text-muted-fg">{t("quietIntro")}</p>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" role="switch" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} className="size-4 accent-[var(--brand)]" />{t("quietOn")}
        </label>
        {quiet ? (
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5"><Label htmlFor="qh-start">{t("from")}</Label><Input id="qh-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-32" /></div>
            <div className="space-y-1.5"><Label htmlFor="qh-end">{t("to")}</Label><Input id="qh-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-32" /></div>
            <p className="pb-2 text-xs text-muted-fg">{t("timezone")}: {tz}</p>
          </div>
        ) : null}
      </Card>

      <Card className="space-y-2">
        <Label htmlFor="wa">{t("whatsapp")}</Label>
        <Input id="wa" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="max-w-xs"
          aria-invalid={phoneError} aria-describedby={phoneError ? "wa-hint wa-err" : "wa-hint"} required={usesWhatsapp} />
        <p id="wa-hint" className="text-xs text-muted-fg">{t("whatsappHint")}</p>
        <FieldError><span id="wa-err">{phoneError ? t("whatsappInvalid") : null}</span></FieldError>
      </Card>

      <Button type="submit" disabled={save.isPending}>{t("save")}</Button>
    </form>
  );
}
