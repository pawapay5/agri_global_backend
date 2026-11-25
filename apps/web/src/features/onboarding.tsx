"use client";
import { Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { useFeedback } from "@/components/feedback/feedback";
import { Button, Input } from "@/components/ui/primitives";
import { useRouter } from "@/i18n/navigation";
import { ApiError } from "@/lib/api/browser";
import { useCommodities, useMarkets, useMe, useSaveInterests, useUpdateMe } from "@/lib/api/queries";
import { cn, pick } from "@/lib/utils";

const ROLES = ["farmer", "trader", "consumer", "researcher", "student", "policymaker"] as const;
const TOPICS = ["prices", "forecasts", "weather", "export", "policy", "research"] as const;
type Role = (typeof ROLES)[number];
type Topic = (typeof TOPICS)[number];
const STEPS = 4;

/**
 * First-run setup after sign-up: role → crops → markets → topics. Saves with PATCH /v1/me (role) and
 * PUT /v1/me/interests. Every step can be skipped; nothing here is required to use the app.
 */
export function Onboarding() {
  const t = useTranslations("onboarding");
  const locale = useLocale();
  const router = useRouter();
  const feedback = useFeedback();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const commodities = useCommodities(cc);
  const markets = useMarkets(cc);
  const updateMe = useUpdateMe();
  const saveInterests = useSaveInterests();

  const [step, setStep] = useState(1);
  const [role, setRole] = useState<Role | null>(null);
  const [crops, setCrops] = useState<Set<string>>(new Set());
  const [mkts, setMkts] = useState<Set<string>>(new Set());
  const [topics, setTopics] = useState<Set<Topic>>(new Set(["prices", "forecasts"]));
  const [showCropError, setShowCropError] = useState(false);
  const saving = updateMe.isPending || saveInterests.isPending;
  const effectiveRole = role ?? (ROLES.includes(me.data?.role as Role) ? (me.data!.role as Role) : null);

  const finish = async () => {
    try {
      if (effectiveRole && effectiveRole !== me.data?.role) await updateMe.mutateAsync({ role: effectiveRole });
      await saveInterests.mutateAsync({ commodityIds: [...crops], marketIds: [...mkts], topics: [...topics] });
      router.replace("/app");
    } catch (e) {
      feedback.error(e instanceof ApiError ? e.detail ?? e.code : t("loadError"));
    }
  };

  const next = () => {
    if (step === 2 && crops.size === 0) { setShowCropError(true); return; }
    if (step < STEPS) setStep(step + 1); else void finish();
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between">
        <Logo suffix={cc || undefined} />
        <button type="button" onClick={() => router.replace("/app")} className="text-sm font-medium text-muted-fg hover:text-foreground">{t("skip")}</button>
      </header>

      <div>
        <p className="text-sm text-muted-fg">{t("stepOf", { n: step, total: STEPS })}</p>
        <div className="mt-2 grid grid-cols-4 gap-1.5" aria-hidden>
          {Array.from({ length: STEPS }, (_, i) => <span key={i} className={cn("h-1.5 rounded-full", i < step ? "bg-brand" : "bg-muted")} />)}
        </div>
      </div>

      <section aria-labelledby="ob-title" className="flex-1 space-y-4">
        {step === 1 && (
          <>
            <StepHead id="ob-title" title={t("roleTitle")} body={t("roleBody")} />
            <div role="radiogroup" aria-labelledby="ob-title" className="grid gap-3 sm:grid-cols-2">
              {ROLES.map((r) => (
                <ChoiceCard key={r} role="radio" checked={effectiveRole === r} onClick={() => setRole(r)} label={t(`role_${r}`)} />
              ))}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <StepHead id="ob-title" title={t("cropsTitle")} body={t("cropsBody")} />
            <Picker
              loading={commodities.isPending} error={commodities.isError} errorText={t("loadError")}
              items={(commodities.data?.data ?? []).map((c) => ({ id: c.id, label: pick(c.name, locale) }))}
              selected={crops} onToggle={(id) => { setShowCropError(false); setCrops(toggle(crops, id)); }}
              searchLabel={t("search")} countLabel={t("selected", { count: crops.size })} labelledBy="ob-title"
            />
            {showCropError ? <p role="alert" className="text-sm text-down">{t("cropsPick")}</p> : null}
          </>
        )}

        {step === 3 && (
          <>
            <StepHead id="ob-title" title={t("marketsTitle")} body={t("marketsBody")} />
            <Picker
              loading={markets.isPending} error={markets.isError} errorText={t("loadError")}
              items={(markets.data?.data ?? []).map((m) => ({ id: m.id, label: pick(m.name, locale), hint: pick(m.regionName, locale) }))}
              selected={mkts} onToggle={(id) => setMkts(toggle(mkts, id))}
              searchLabel={t("search")} countLabel={t("selected", { count: mkts.size })} labelledBy="ob-title"
            />
          </>
        )}

        {step === 4 && (
          <>
            <StepHead id="ob-title" title={t("topicsTitle")} body={t("topicsBody")} />
            <div role="group" aria-labelledby="ob-title" className="grid gap-3 sm:grid-cols-2">
              {TOPICS.map((tp) => (
                <ChoiceCard key={tp} role="checkbox" checked={topics.has(tp)} onClick={() => setTopics(toggle(topics, tp))} label={t(`topic_${tp}`)} />
              ))}
            </div>
          </>
        )}
      </section>

      <footer className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <Button variant="ghost" onClick={() => setStep(Math.max(1, step - 1))} disabled={step === 1 || saving}>{t("back")}</Button>
        <Button onClick={next} disabled={saving}>{saving ? t("saving") : step === STEPS ? t("finish") : t("next")}</Button>
      </footer>
    </div>
  );
}

function toggle<T>(set: Set<T>, v: T) {
  const n = new Set(set);
  if (n.has(v)) n.delete(v); else n.add(v);
  return n;
}

function StepHead({ id, title, body }: { id: string; title: string; body: string }) {
  return <div><h1 id={id} className="text-2xl font-bold">{title}</h1><p className="mt-1 text-sm text-muted-fg">{body}</p></div>;
}

function ChoiceCard({ role, checked, onClick, label }: { role: "radio" | "checkbox"; checked: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" role={role} aria-checked={checked} onClick={onClick}
      className={cn("flex items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3 text-start text-sm font-medium transition-colors",
        checked ? "border-brand ring-2 ring-[var(--ring)]" : "border-border hover:border-brand/50")}>
      {label}
      <span aria-hidden className={cn("grid size-5 place-items-center rounded-full border", checked ? "border-brand bg-brand text-brand-fg" : "border-border")}>
        {checked ? <Check className="size-3.5" /> : null}
      </span>
    </button>
  );
}

/** Searchable multi-select chips; the search only filters what's shown, never what's selected. */
function Picker({ items, selected, onToggle, loading, error, errorText, searchLabel, countLabel, labelledBy }: {
  items: { id: string; label: string; hint?: string }[]; selected: Set<string>; onToggle: (id: string) => void;
  loading: boolean; error: boolean; errorText: string; searchLabel: string; countLabel: string; labelledBy: string;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? items.filter((i) => i.label.toLowerCase().includes(needle)) : items;
  }, [items, q]);
  if (error) return <p className="rounded-xl bg-muted p-4 text-sm text-muted-fg">{errorText}</p>;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchLabel} aria-label={searchLabel} className="max-w-xs" />
        <span className="text-sm text-muted-fg" aria-live="polite">{countLabel}</span>
      </div>
      {loading ? <div className="h-32 animate-pulse rounded-2xl bg-muted" /> : (
        <ul aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
          {shown.map((i) => (
            <li key={i.id}>
              <button type="button" role="checkbox" aria-checked={selected.has(i.id)} onClick={() => onToggle(i.id)}
                className={cn("rounded-full border px-3.5 py-1.5 text-sm", selected.has(i.id) ? "border-brand bg-brand text-brand-fg" : "border-border bg-card hover:border-brand/50")}>
                {i.label}{i.hint ? <span className="ms-1 opacity-70">· {i.hint}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
