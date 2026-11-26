"use client";
import { ArrowLeftRight, Copy, Languages, Mic, Pause, Play, Send, Sparkles, Square, Trash2, TriangleAlert, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/agri/empty-state";
import { RangeTabs } from "@/components/agri/range-tabs";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Badge, Button, Card, FieldError, Label, Skeleton } from "@/components/ui/primitives";
import { answerAudioUrl, useAsk, useAssistantHistory, useAssistantStatus, useClearAssistant, useTranslate, type AssistantLanguage, type AssistantMessage } from "@/lib/api/assistant";
import { canRecord, MAX_SECONDS, startRecording } from "@/lib/audio/wav";
import { money, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { QueryState } from "./common";

const LANGS = ["twi", "fat", "ewe", "gaa", "dag", "eng"] as const satisfies readonly AssistantLanguage[];
const TABS = ["ask", "translate"] as const;
const MAX_CHARS = 500;
/** The app's own locales mapped to the assistant's languages (Khaya codes), so a Twi user starts in Twi. */
export const defaultLanguage = (locale: string): AssistantLanguage =>
  ({ tw: "twi", ak: "twi", ee: "ewe", dag: "dag", gaa: "gaa", fat: "fat" } as Record<string, AssistantLanguage>)[locale.split("-")[0]!] ?? "twi";

type Fact = AssistantMessage["facts"][number];
/** One line per figure, written from the data, never from the translated text (exported for tests). */
export function factLine(f: Fact, locale: string, t: (k: string, v?: Record<string, string | number>) => string): string {
  const per = f.unit ? ` / ${f.unit}` : "";
  if (f.kind === "forecast") {
    return t("factForecast", { crop: f.commodity, place: f.place ?? "", months: f.horizonMonths ?? 0, date: f.targetDate ? shortDate(f.targetDate, locale, { day: "numeric", month: "short", year: "numeric" }) : "",
      low: money(f.low, f.currency ?? "", locale), high: money(f.high, f.currency ?? "", locale), mid: money(f.mid, f.currency ?? "", locale), per });
  }
  return t("factPrice", { crop: f.commodity, market: f.market ?? "", price: money(f.amount, f.currency ?? "", locale), per, type: f.priceType ?? "",
    date: f.observedAt ? shortDate(f.observedAt, locale, { day: "numeric", month: "short", year: "numeric" }) : "" });
}

/** /app/assistant: ask about prices, forecasts, weather and planting in Twi, Fante, Ewe, Ga, Dagbani or English. */
export function Assistant() {
  const t = useTranslations("asst");
  const status = useAssistantStatus();
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(TABS).withDefault("ask"));
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand text-brand-fg"><Sparkles aria-hidden className="size-5" /></span>
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-fg">{t("intro")}</p>
        </div>
      </div>
      <QueryState q={status} skeleton={<Skeleton className="h-96" />}>
        {(s) => !s.enabled ? (
          <EmptyState icon={Sparkles} title={t("offTitle")} description={t("offBody")} />
        ) : (
          <>
            <RangeTabs label={t("mode")} value={tab} onChange={(v) => setTab(v === "ask" ? null : v)} options={[{ value: "ask", label: t("tabAsk") }, { value: "translate", label: t("tabTranslate") }]} />
            {tab === "translate"
              ? (s.translation ? <Translator languages={s.languages.map((l) => l.code)} /> : <EmptyState icon={Languages} title={t("noTranslation")} />)
              : <Ask languages={s.languages.map((l) => l.code)} used={s.usedToday} limit={s.dailyLimit} retention={s.retentionDays} />}
          </>
        )}
      </QueryState>
    </div>
  );
}

function LanguageSelect({ id, value, onChange, options, label }: { id: string; value: AssistantLanguage; onChange: (v: AssistantLanguage) => void; options: AssistantLanguage[]; label: string }) {
  const t = useTranslations("asst");
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as AssistantLanguage)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm">
        {options.map((l) => <option key={l} value={l}>{t(`lang_${l}`)}</option>)}
      </select>
    </div>
  );
}

function Ask({ languages, used, limit, retention }: { languages: AssistantLanguage[]; used: number; limit: number; retention: number }) {
  const t = useTranslations("asst");
  const locale = useLocale();
  const history = useAssistantHistory();
  const ask = useAsk();
  const clear = useClearAssistant();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const options = LANGS.filter((l) => languages.includes(l));
  const [lang, setLang] = useQueryState("lang", parseAsStringLiteral(LANGS).withDefault(options.includes(defaultLanguage(locale)) ? defaultLanguage(locale) : options[0] ?? "eng"));
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const items = history.data?.data ?? [];
  const conversationId = history.data?.conversationId ?? null;
  const voiceOk = lang !== "eng" && canRecord();
  const left = Math.max(0, limit - used);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [items.length, ask.isPending]);

  const send = (q: { text: string } | { audio: Blob }) => {
    setErr(null);
    ask.mutate({ language: lang, conversationId, ...q }, {
      onSuccess: () => setText(""),
      onError: (x) => fb.error(problem(x as never)),
    });
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (!q) { setErr(t("emptyQuestion")); document.getElementById("asst-q")?.focus(); return; }
    send({ text: q.slice(0, MAX_CHARS) });
  };
  const wipe = async () => {
    if (!(await fb.confirm({ title: t("clearTitle"), description: t("clearBody"), confirmLabel: t("clear"), destructive: true }))) return;
    clear.mutate(undefined, { onSuccess: () => fb.success(t("cleared")), onError: (x) => fb.error(problem(x as never)) });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <LanguageSelect id="asst-lang" label={t("language")} value={lang} onChange={(v) => setLang(v)} options={options} />
        <p className="text-sm text-muted-fg sm:pb-3" aria-live="polite">{t("usage", { left, limit })}</p>
      </div>

      <Card className="space-y-4 p-4 sm:p-5">
        {history.isPending ? <Skeleton className="h-40" /> : !items.length ? (
          <div className="space-y-2 py-6 text-center">
            <p className="font-semibold">{t("emptyTitle")}</p>
            <p className="mx-auto max-w-md text-sm text-muted-fg">{t("emptyBody")}</p>
          </div>
        ) : (
          <ol className="space-y-5" aria-label={t("conversation")}>
            {items.map((m) => <li key={m.id}><Exchange m={m} /></li>)}
          </ol>
        )}
        {ask.isPending ? <p role="status" className="flex items-center gap-2 text-sm text-muted-fg"><span className="size-2 animate-pulse rounded-full bg-brand" />{t("thinking")}</p> : null}
        <div ref={endRef} />
      </Card>

      <form onSubmit={submit} noValidate className="space-y-2">
        <Label htmlFor="asst-q">{t("question")}</Label>
        <textarea id="asst-q" rows={3} maxLength={MAX_CHARS} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={Boolean(err)} aria-describedby="asst-q-hint"
          placeholder={t("placeholder")} disabled={ask.isPending || left === 0}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
          className="w-full rounded-2xl border border-border bg-background p-3 text-base" />
        <p id="asst-q-hint" className="text-xs text-muted-fg">{t("hint")}</p>
        <FieldError>{err}</FieldError>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={ask.isPending || left === 0}><Send aria-hidden className="size-4" />{t("send")}</Button>
          {voiceOk ? <VoiceButton disabled={ask.isPending || left === 0} onAudio={(audio) => send({ audio })} /> : null}
          {items.length ? <Button type="button" variant="ghost" onClick={wipe} disabled={clear.isPending} className="ms-auto"><Trash2 aria-hidden className="size-4" />{t("clear")}</Button> : null}
        </div>
      </form>
      <p className="text-xs text-muted-fg">{t("disclaimer", { days: retention })}</p>
    </div>
  );
}

/** Tap to start, tap to stop. The recording is converted to WAV on the device before it's sent. */
function VoiceButton({ onAudio, disabled }: { onAudio: (wav: Blob) => void; disabled: boolean }) {
  const t = useTranslations("asst");
  const fb = useFeedback();
  const rec = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null);
  const [state, setState] = useState<"idle" | "recording" | "processing">("idle");
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (state !== "recording") return;
    const id = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [state]);
  useEffect(() => () => rec.current?.cancel(), []);

  const stop = async () => {
    if (!rec.current) return;
    setState("processing");
    try { onAudio(await rec.current.stop()); } catch { fb.error(t("micFailed")); } finally { rec.current = null; setState("idle"); }
  };
  const start = async () => {
    try {
      rec.current = await startRecording(() => void stop());
      setSecs(0); setState("recording");
    } catch {
      fb.error(t("micDenied"));
    }
  };
  if (state === "recording") return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" variant="danger" onClick={() => void stop()}><Square aria-hidden className="size-4" />{t("stopRecording", { s: secs, max: MAX_SECONDS })}</Button>
      <Button type="button" variant="ghost" onClick={() => { rec.current?.cancel(); rec.current = null; setState("idle"); }} aria-label={t("cancelRecording")}><X aria-hidden className="size-4" /></Button>
      <span role="status" className="sr-only">{t("recording")}</span>
    </span>
  );
  return (
    <Button type="button" variant="outline" onClick={() => void start()} disabled={disabled || state === "processing"}>
      <Mic aria-hidden className="size-4" />{state === "processing" ? t("preparing") : t("speak")}
    </Button>
  );
}

function Exchange({ m }: { m: AssistantMessage }) {
  const t = useTranslations("asst");
  const locale = useLocale();
  const [english, setEnglish] = useState(false);
  return (
    <div className="space-y-2">
      <div className="ms-auto w-fit max-w-[85%] rounded-2xl rounded-ee-md bg-brand px-4 py-2.5 text-brand-fg">
        <p className="flex items-start gap-2">{m.inputMode === "voice" ? <Mic aria-label={t("spoken")} className="mt-1 size-3.5 shrink-0" /> : null}<span lang={htmlLang(m.language)}>{m.question}</span></p>
      </div>
      <div className="max-w-[92%] space-y-3 rounded-2xl rounded-es-md border border-border bg-muted/40 px-4 py-3">
        <p className="text-base leading-relaxed" lang={htmlLang(m.language)}>{m.answer}</p>
        {m.translated && english ? <p className="border-t border-border pt-2 text-sm text-muted-fg" lang="en">{m.answerEnglish}</p> : null}
        {m.translated && !m.numbersPreserved && m.facts.length ? (
          <p className="flex items-start gap-2 rounded-xl bg-info p-2.5 text-sm"><TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />{t("checkFigures")}</p>
        ) : null}
        {m.facts.length ? (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-fg">{t("figures")}</p>
            <ul className="space-y-1 text-sm">
              {m.facts.map((f, i) => (
                <li key={i} className="flex items-start gap-2"><Badge tone={f.kind === "forecast" ? "forecast" : "neutral"}>{f.kind === "forecast" ? t("forecast") : t("price")}</Badge><span>{factLine(f, locale, t)}</span></li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {m.hasVoice ? <Listen id={m.id} /> : null}
          {m.translated ? <Button type="button" size="sm" variant="ghost" onClick={() => setEnglish((v) => !v)} aria-pressed={english}>{english ? t("hideEnglish") : t("showEnglish")}</Button> : null}
          {m.translated ? <span className="text-xs text-muted-fg">{t("machineTranslated")}</span> : null}
        </div>
      </div>
    </div>
  );
}

const htmlLang = (l: string) => ({ twi: "tw", fat: "fat", ewe: "ee", gaa: "gaa", dag: "dag", eng: "en" } as Record<string, string>)[l] ?? "en";

function Listen({ id }: { id: string }) {
  const t = useTranslations("asst");
  const fb = useFeedback();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  useEffect(() => () => { audio.current?.pause(); }, []);
  const toggle = () => {
    if (state === "playing") { audio.current?.pause(); setState("idle"); return; }
    let a = audio.current;
    if (!a) {
      a = new Audio(answerAudioUrl(id));
      a.addEventListener("ended", () => setState("idle"));
      a.addEventListener("error", () => { setState("idle"); audio.current = null; fb.error(t("audioFailed")); });
      audio.current = a;
    }
    setState("loading");
    a.play().then(() => setState("playing"), () => { setState("idle"); });
  };
  return (
    <Button type="button" size="sm" variant="outline" onClick={toggle} disabled={state === "loading"} aria-pressed={state === "playing"}>
      {state === "playing" ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
      {state === "loading" ? t("loadingAudio") : state === "playing" ? t("pause") : t("listen")}
    </Button>
  );
}

function Translator({ languages }: { languages: AssistantLanguage[] }) {
  const t = useTranslations("asst");
  const locale = useLocale();
  const tr = useTranslate();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const options = LANGS.filter((l) => languages.includes(l));
  const [from, setFrom] = useState<AssistantLanguage>("eng");
  const [to, setTo] = useState<AssistantLanguage>(options.includes(defaultLanguage(locale)) ? defaultLanguage(locale) : "twi");
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) { setErr(t("emptyText")); document.getElementById("tr-text")?.focus(); return; }
    if (from === to) { setErr(t("sameLanguage")); return; }
    setErr(null);
    tr.mutate({ text: text.trim().slice(0, 2000), from, to }, { onError: (x) => fb.error(problem(x as never)) });
  };
  const copy = async () => {
    if (!tr.data) return;
    try { await navigator.clipboard.writeText(tr.data.text); fb.success(t("copied")); } catch { fb.error(t("copyFailed")); }
  };
  return (
    <Card className="space-y-4">
      <form onSubmit={submit} noValidate className="space-y-3">
        <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto_1fr]">
          <LanguageSelect id="tr-from" label={t("from")} value={from} onChange={setFrom} options={options} />
          <Button type="button" variant="ghost" onClick={() => { setFrom(to); setTo(from); if (tr.data) setText(tr.data.text); tr.reset(); }} aria-label={t("swap")} className="justify-self-center"><ArrowLeftRight aria-hidden className="size-4" /></Button>
          <LanguageSelect id="tr-to" label={t("to")} value={to} onChange={setTo} options={options} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tr-text">{t("textToTranslate")}</Label>
          <textarea id="tr-text" rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={Boolean(err)} lang={htmlLang(from)}
            className="w-full rounded-2xl border border-border bg-background p-3 text-base" />
          <FieldError>{err}</FieldError>
        </div>
        <Button type="submit" disabled={tr.isPending}><Languages aria-hidden className="size-4" />{tr.isPending ? t("translating") : t("translate")}</Button>
      </form>
      {tr.data ? (
        <div className={cn("space-y-2 rounded-2xl border border-border bg-muted/40 p-4")} aria-live="polite">
          <p className="text-base leading-relaxed" lang={htmlLang(tr.data.to)}>{tr.data.text}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void copy()}><Copy aria-hidden className="size-4" />{t("copy")}</Button>
            <span className="text-xs text-muted-fg">{tr.data.viaEnglish ? t("viaEnglish") : t("machineTranslated")}</span>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
