"use client";
import { BadgeCheck, BookOpen, Bug, CalendarDays, Calculator, ExternalLink, GraduationCap, Landmark, MapPin, MessageCircle, Phone, Printer, Search, ShieldAlert, Sprout, Tag, TrendingUp, Truck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsBoolean, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useState } from "react";
import { EmptyState } from "@/components/agri/empty-state";
import { RangeTabs } from "@/components/agri/range-tabs";
import { Markdown } from "@/components/content/markdown";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Badge, Button, Card, CardTitle, FieldError, Input, Label, Skeleton } from "@/components/ui/primitives";
import { Link, usePathname } from "@/i18n/navigation";
import { ApiError } from "@/lib/api/browser";
import { useCropGuide, useCropGuides, useFertiliserPlan, usePest, usePests, useProgrammes, useSubmitPrice, useSuppliers, useTraining, type SupplierCategory } from "@/lib/api/community";
import { useCommodities, useMarkets, useMe, useRegions } from "@/lib/api/queries";
import { number } from "@/lib/format";
import { cn, pick } from "@/lib/utils";
import { PageTitle, UpgradePrompt } from "./common";
import { LocationPicker, useOrigin } from "./location";
import { isHttp } from "./market-common";

export const TOOLS = [
  { href: "/app/tools/fertiliser", key: "fertiliser", icon: Calculator },
  { href: "/app/tools/report-price", key: "reportPrice", icon: Tag },
  { href: "/app/tools/pests", key: "pests", icon: Bug },
  { href: "/app/tools/guides", key: "guides", icon: BookOpen },
  { href: "/app/tools/programmes", key: "programmes", icon: Landmark },
  { href: "/app/tools/training", key: "training", icon: GraduationCap },
  { href: "/app/tools/suppliers", key: "suppliers", icon: Truck },
  { href: "/app/tools/market-intel", key: "intel", icon: TrendingUp },
] as const;

export function ToolsNav() {
  const t = useTranslations("tools");
  const path = usePathname();
  return (
    <nav aria-label={t("sections")} className="-mx-1 mb-6 overflow-x-auto px-1">
      <ul className="inline-flex gap-1 rounded-xl bg-muted p-1">
        {[{ href: "/app/tools", key: "hub", icon: Sprout } as const, ...TOOLS].map(({ href, key, icon: Icon }) => {
          const on = href === "/app/tools" ? path === href : path === href || path.startsWith(`${href}/`);
          return <li key={key}><Link href={href} aria-current={on ? "page" : undefined} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium", on ? "bg-card shadow-sm" : "text-muted-fg hover:text-foreground")}><Icon aria-hidden className="size-4" />{t(key)}</Link></li>;
        })}
      </ul>
    </nav>
  );
}

export function ToolsHub() {
  const t = useTranslations("tools");
  return (
    <div>
      <PageTitle title={t("title")} subtitle={t("intro")} />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TOOLS.map(({ href, key, icon: Icon }) => (
          <li key={key}><Link href={href} className="block h-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Card className="flex h-full flex-col gap-2 transition-shadow hover:shadow-md">
              <span className="grid size-10 place-items-center rounded-xl bg-info text-brand"><Icon aria-hidden className="size-5" /></span>
              <span className="font-semibold">{t(key)}</span><span className="text-sm text-muted-fg">{t(`${key}Body`)}</span>
            </Card>
          </Link></li>
        ))}
      </ul>
    </div>
  );
}

const fmtDate = (d: string | null | undefined, locale: string) => (d ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(d.length === 10 ? `${d}T00:00:00Z` : d)) : "");
const select = "h-10 w-full rounded-xl border border-border bg-background px-3 text-sm";

// ── Fertiliser ──
const AREA_UNITS = ["ha", "acre", "m2"] as const;
const FARMING = ["subsistence", "commercial", "mixed", "organic", "irrigated", "rainfed"] as const;

/** /app/tools/fertiliser: a plan from an agronomist-reviewed rule, always with its safety note. */
export function FertiliserCalculator() {
  const t = useTranslations("tools");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const commodities = useCommodities(cc);
  const regions = useRegions(cc);
  const calc = useFertiliserPlan();
  const problem = useProblemMessage();
  const [f, setF] = useState({ commodityId: "", area: "", areaUnit: "acre" as (typeof AREA_UNITS)[number], regionId: "", farmingType: "" as "" | (typeof FARMING)[number] });
  const [bad, setBad] = useState(false);
  const commodityId = f.commodityId || commodities.data?.data[0]?.id || "";
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const area = Number(f.area);
    if (!(area > 0) || area > 100000) { setBad(true); document.getElementById("fz-area")?.focus(); return; }
    setBad(false);
    calc.mutate({ country: cc, commodityId, area, areaUnit: f.areaUnit, ...(f.regionId ? { regionId: f.regionId } : {}), ...(f.farmingType ? { farmingType: f.farmingType } : {}) });
  };
  const p = calc.data;
  const err = calc.error instanceof ApiError ? calc.error : null;
  return (
    <div className="space-y-5">
      <PageTitle title={t("fertiliser")} subtitle={t("fertiliserBody")} />
      <Card>
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <div className="space-y-1"><Label htmlFor="fz-crop">{t("crop")}</Label><select id="fz-crop" value={commodityId} onChange={(e) => setF({ ...f, commodityId: e.target.value })} className={select}>{(commodities.data?.data ?? []).map((c) => <option key={c.id} value={c.id}>{pick(c.name, locale)}</option>)}</select></div>
          <div className="space-y-1"><Label htmlFor="fz-area">{t("area")}</Label><Input id="fz-area" inputMode="decimal" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} aria-invalid={bad} aria-describedby={bad ? "fz-area-err" : undefined} /></div>
          <div className="space-y-1"><Label htmlFor="fz-unit">{t("areaUnit")}</Label><select id="fz-unit" value={f.areaUnit} onChange={(e) => setF({ ...f, areaUnit: e.target.value as typeof f.areaUnit })} className={select}>{AREA_UNITS.map((u) => <option key={u} value={u}>{t(`u_${u}`)}</option>)}</select></div>
          <div className="space-y-1"><Label htmlFor="fz-region">{t("region")}</Label><select id="fz-region" value={f.regionId} onChange={(e) => setF({ ...f, regionId: e.target.value })} className={select}><option value="">{t("anyRegion")}</option>{(regions.data ?? []).map((r) => <option key={r.id} value={r.id}>{pick(r.name, locale)}</option>)}</select></div>
          <div className="space-y-1"><Label htmlFor="fz-type">{t("farmingType")}</Label><select id="fz-type" value={f.farmingType} onChange={(e) => setF({ ...f, farmingType: e.target.value as typeof f.farmingType })} className={select}><option value="">—</option>{FARMING.map((x) => <option key={x} value={x}>{t(`ft_${x}`)}</option>)}</select></div>
          <div className="sm:col-span-2 lg:col-span-5"><FieldError><span id="fz-area-err">{bad ? t("areaBad") : null}</span></FieldError><Button type="submit" disabled={calc.isPending || !commodityId}>{t("calculate")}</Button></div>
        </form>
      </Card>
      {err ? (err.status === 402 ? <UpgradePrompt detail={err.detail} /> : err.status === 404 ? <EmptyState icon={Calculator} title={t("noRule")} /> : <Card role="alert" className="text-sm">{problem(err as never)}</Card>) : null}
      {p ? (
        <Card className="space-y-4 print:shadow-none" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle>{t("plan")}</CardTitle><span className="text-sm text-muted-fg">{t("forHa", { ha: number(Number(p.hectares), locale, { digits: 2 }) })}</span>
          </div>
          <p className="flex items-start gap-2 rounded-xl bg-forecast/10 p-3 text-sm text-forecast-ink"><ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" /><span><strong>{t("safety")}:</strong> {p.safetyNote}</span></p>
          <div className="overflow-x-auto rounded-xl border border-border" tabIndex={0} role="region" aria-label={t("plan")}>
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="sr-only">{t("plan")}</caption>
              <thead className="bg-muted text-muted-fg"><tr>{["stage", "product", "amountKg", "timing", "method"].map((k) => <th key={k} scope="col" className="px-3 py-2 text-start font-medium">{t(k)}</th>)}</tr></thead>
              <tbody>
                {p.applications.map((a, i) => (
                  <tr key={i} className="border-t border-border align-top">
                    <th scope="row" className="px-3 py-2 text-start font-medium">{a.stage}</th>
                    <td className="px-3 py-2">{a.product}</td>
                    <td className="px-3 py-2 tabular">{number(Number(a.kg), locale, { digits: 1 })} kg{a.bags != null && a.bagKg ? <span className="block text-xs text-muted-fg">{t("bags", { n: number(a.bags, locale, { digits: 1 }), kg: a.bagKg })}</span> : null}</td>
                    <td className="px-3 py-2">{a.timing}</td>
                    <td className="px-3 py-2 text-muted-fg">{a.method ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {p.totals ? <p className="text-sm"><strong>{t("totals")}:</strong> {number(Number(p.totals.kg), locale, { digits: 1 })} kg · {t("nutrients", { n: p.totals.nKg ?? "—", p: p.totals.p2o5Kg ?? "—", k: p.totals.k2oKg ?? "—" })}</p> : null}
          {p.notes ? <p className="whitespace-pre-wrap text-sm">{p.notes}</p> : null}
          <p className="text-xs text-muted-fg">{p.source ? `${t("source", { source: p.source })} · ` : ""}{t("reviewed", { date: fmtDate(p.reviewedAt, locale) })}</p>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="print:hidden"><Printer aria-hidden className="size-4" />{t("print")}</Button>
        </Card>
      ) : null}
    </div>
  );
}

// ── Report a price ──
const PRICE_TYPES = ["wholesale", "retail", "farm_gate"] as const;
/** Local date-time for a datetime-local input. */
const localNow = () => { const d = new Date(); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };

/** Price must be positive, a market chosen, and the time not in the future (exported for tests). */
export function priceReportProblem(r: { marketId: string; amount: string; observedAt: string }, now = Date.now()): "pickMarket" | "priceBad" | "whenBad" | null {
  if (!r.marketId) return "pickMarket";
  if (!(Number(r.amount) > 0)) return "priceBad";
  const at = new Date(r.observedAt).getTime();
  if (!Number.isFinite(at) || at > now + 60_000) return "whenBad";
  return null;
}

export function ReportPrice() {
  const t = useTranslations("tools");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const commodities = useCommodities(cc);
  const markets = useMarkets(cc);
  const submit = useSubmitPrice();
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [r, setR] = useState(() => ({ commodityId: "", marketId: "", priceType: "wholesale" as (typeof PRICE_TYPES)[number], amount: "", currency: "", unit: "kg", quality: "" as "" | "low" | "medium" | "high", observedAt: localNow(), note: "" }));
  const [err, setErr] = useState<string | null>(null);
  const commodityId = r.commodityId || commodities.data?.data[0]?.id || "";
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const p = priceReportProblem(r);
    if (p || !/^[A-Z]{3}$/.test(r.currency)) { setErr(t(p ?? "priceBad")); return; }
    setErr(null);
    submit.mutate({
      commodityId, marketId: r.marketId, priceType: r.priceType, amount: r.amount.trim(), currency: r.currency, unit: r.unit.trim(), observedAt: new Date(r.observedAt).toISOString(),
      ...(r.quality ? { quality: r.quality } : {}), ...(r.note.trim() ? { note: r.note.trim().slice(0, 500) } : {}),
    }, { onSuccess: () => fb.success(t("submitted")), onError: (x) => fb.error(problem(x as never)) });
  };
  if (submit.data) {
    const st = submit.data.status;
    return (
      <div className="max-w-2xl space-y-5">
        <PageTitle title={t("reportPrice")} />
        <Card role="status" className="space-y-3"><p className="font-semibold">{t("submitted")}</p><p className="text-sm">{t(`st_${st}`)}</p><Button variant="outline" size="sm" onClick={() => { submit.reset(); setR({ ...r, amount: "", note: "", observedAt: localNow() }); }}>{t("another")}</Button></Card>
      </div>
    );
  }
  return (
    <div className="max-w-2xl space-y-5">
      <PageTitle title={t("reportPrice")} subtitle={t("reportPriceBody")} />
      <Card>
        <form onSubmit={send} noValidate className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="rp-crop">{t("crop")}</Label><select id="rp-crop" value={commodityId} onChange={(e) => setR({ ...r, commodityId: e.target.value })} className={select}>{(commodities.data?.data ?? []).map((c) => <option key={c.id} value={c.id}>{pick(c.name, locale)}</option>)}</select></div>
          <div className="space-y-1"><Label htmlFor="rp-market">{t("market")}</Label><select id="rp-market" value={r.marketId} onChange={(e) => setR({ ...r, marketId: e.target.value })} className={select}><option value="">—</option>{(markets.data?.data ?? []).map((m) => <option key={m.id} value={m.id}>{pick(m.name, locale)}</option>)}</select></div>
          <div className="space-y-1"><Label htmlFor="rp-type">{t("priceType")}</Label><select id="rp-type" value={r.priceType} onChange={(e) => setR({ ...r, priceType: e.target.value as typeof r.priceType })} className={select}>{PRICE_TYPES.map((x) => <option key={x} value={x}>{t(`pt_${x}`)}</option>)}</select></div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-1 space-y-1"><Label htmlFor="rp-amount">{t("amount")}</Label><Input id="rp-amount" inputMode="decimal" value={r.amount} onChange={(e) => setR({ ...r, amount: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="rp-cur">{t("currency")}</Label><Input id="rp-cur" maxLength={3} value={r.currency} onChange={(e) => setR({ ...r, currency: e.target.value.toUpperCase() })} placeholder="GHS" /></div>
            <div className="space-y-1"><Label htmlFor="rp-unit">{t("unit")}</Label><Input id="rp-unit" maxLength={32} value={r.unit} onChange={(e) => setR({ ...r, unit: e.target.value })} /></div>
          </div>
          <div className="space-y-1"><Label htmlFor="rp-quality">{t("quality")}</Label><select id="rp-quality" value={r.quality} onChange={(e) => setR({ ...r, quality: e.target.value as typeof r.quality })} className={select}><option value="">—</option>{(["low", "medium", "high"] as const).map((q) => <option key={q} value={q}>{t(`q_${q}`)}</option>)}</select></div>
          <div className="space-y-1"><Label htmlFor="rp-when">{t("observedAt")}</Label><Input id="rp-when" type="datetime-local" value={r.observedAt} max={localNow()} onChange={(e) => setR({ ...r, observedAt: e.target.value })} suppressHydrationWarning /></div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="rp-note">{t("note")}</Label><textarea id="rp-note" rows={2} maxLength={500} value={r.note} onChange={(e) => setR({ ...r, note: e.target.value })} className="w-full rounded-xl border border-border bg-background p-3 text-sm" /></div>
          <div className="sm:col-span-2"><FieldError>{err}</FieldError><Button type="submit" disabled={submit.isPending || !commodityId}>{t("submit")}</Button></div>
        </form>
      </Card>
    </div>
  );
}

// ── Pests ──
const KINDS = ["all", "pest", "disease", "weed", "deficiency"] as const;
export function PestsList() {
  const t = useTranslations("tools");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const commodities = useCommodities(cc);
  const [f, setF] = useQueryStates({ q: parseAsString.withDefault(""), kind: parseAsStringLiteral(KINDS).withDefault("all"), commodity: parseAsString });
  const [q, setQ] = useState(f.q);
  const pests = usePests(cc, { q: f.q, kind: f.kind === "all" ? undefined : f.kind, commodityId: f.commodity ?? undefined });
  return (
    <div className="space-y-5">
      <PageTitle title={t("pests")} subtitle={t("pestsBody")} />
      <form role="search" onSubmit={(e) => { e.preventDefault(); void setF({ q: q.trim() || null }); }} className="relative max-w-md">
        <label htmlFor="pest-q" className="sr-only">{t("search")}</label>
        <Search aria-hidden className="absolute start-3 top-2.5 size-5 text-muted-fg" />
        <Input id="pest-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="ps-10" maxLength={100} />
      </form>
      <div className="flex flex-wrap items-end gap-3">
        <RangeTabs size="sm" label={t("kind")} value={f.kind} onChange={(v) => void setF({ kind: v === "all" ? null : v })} options={KINDS.map((k) => ({ value: k, label: k === "all" ? t("tk_all") : t(`k_${k}`) }))} />
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-fg">{t("crop")}
          <select value={f.commodity ?? ""} onChange={(e) => void setF({ commodity: e.target.value || null })} className="h-9 rounded-xl border border-border bg-background px-2 text-sm text-foreground"><option value="">{t("tk_all")}</option>{(commodities.data?.data ?? []).map((c) => <option key={c.id} value={c.id}>{pick(c.name, locale)}</option>)}</select>
        </label>
      </div>
      {pests.isPending ? <Skeleton className="h-72" /> : !pests.data?.length ? <EmptyState icon={Bug} title={t("noPests")} /> : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pests.data.map((p) => {
            const img = (p.photos?.[0]?.urls as { thumb?: string; medium?: string } | undefined)?.medium;
            return (
              <li key={p.id}><Link href={`/app/tools/pests/${p.id}`} className="block h-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Card className="flex h-full gap-3 hover:shadow-md">
                  {/* eslint-disable-next-line @next/next/no-img-element -- reviewed reference photo from our storage */}
                  {isHttp(img) ? <img src={img} alt="" className="size-16 shrink-0 rounded-lg object-cover" loading="lazy" /> : <span className="grid size-16 shrink-0 place-items-center rounded-lg bg-muted"><Bug aria-hidden className="size-6 text-muted-fg" /></span>}
                  <span className="min-w-0"><span className="block font-semibold">{p.name}</span>{p.scientificName ? <span className="block text-xs italic text-muted-fg">{p.scientificName}</span> : null}<span className="mt-1 line-clamp-2 text-sm text-muted-fg">{p.symptoms}</span></span>
                </Card>
              </Link></li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function PestDetail({ id }: { id: string }) {
  const t = useTranslations("tools");
  const locale = useLocale();
  const pest = usePest(id);
  if (pest.isPending) return <Skeleton className="h-96" />;
  if (pest.isError || !pest.data) return <EmptyState icon={Bug} title={t("noPests")} />;
  const p = pest.data;
  const photos = (p.photos ?? []).map((x) => ({ src: (x.urls as { medium?: string; large?: string })?.medium, caption: x.caption, credit: x.credit })).filter((x) => isHttp(x.src));
  const section = (title: string, body?: string) => (body ? <section className="space-y-1"><h2 className="text-lg font-semibold">{title}</h2><Markdown source={body} className="text-sm" /></section> : null);
  return (
    <article className="max-w-3xl space-y-5">
      <Link href="/app/tools/pests" className="text-sm font-semibold text-brand hover:underline">← {t("pests")}</Link>
      <header>
        <h1 className="text-2xl font-bold">{p.name}</h1>
        {p.scientificName ? <p className="italic text-muted-fg">{p.scientificName}</p> : null}
        {p.reviewedAt ? <p className="mt-1 flex items-center gap-1 text-xs text-up-ink"><BadgeCheck aria-hidden className="size-4" />{t("reviewedShort")} · {fmtDate(p.reviewedAt, locale)}</p> : null}
      </header>
      {photos.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {photos.map((x, i) => (
            <li key={i}><figure>
              {/* eslint-disable-next-line @next/next/no-img-element -- reviewed reference photo */}
              <img src={x.src} alt={x.caption ?? p.name ?? ""} className="aspect-[4/3] w-full rounded-xl object-cover" loading="lazy" />
              {x.caption || x.credit ? <figcaption className="mt-1 text-xs text-muted-fg">{x.caption}{x.credit ? ` · ${x.credit}` : ""}</figcaption> : null}
            </figure></li>
          ))}
        </ul>
      ) : null}
      {p.safetyNote ? <p className="flex items-start gap-2 rounded-xl bg-forecast/10 p-3 text-sm text-forecast-ink"><ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" /><span><strong>{t("safety")}:</strong> {p.safetyNote}</span></p> : null}
      {section(t("symptoms"), p.symptoms)}
      {section(t("prevention"), p.prevention)}
      {section(t("organic"), p.organicControl)}
      {section(t("chemical"), p.chemicalControl)}
    </article>
  );
}

// ── Guides ──
export function GuidesList() {
  const t = useTranslations("tools");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const commodities = useCommodities(cc);
  const [f, setF] = useQueryStates({ commodity: parseAsString });
  const guides = useCropGuides(cc, f.commodity ?? undefined);
  const name = (id?: string) => pick(commodities.data?.data.find((c) => c.id === id)?.name, locale);
  return (
    <div className="space-y-5">
      <PageTitle title={t("guides")} subtitle={t("guidesBody")} />
      <label className="flex max-w-xs flex-col gap-1 text-xs font-medium text-muted-fg">{t("crop")}
        <select value={f.commodity ?? ""} onChange={(e) => void setF({ commodity: e.target.value || null })} className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground"><option value="">{t("tk_all")}</option>{(commodities.data?.data ?? []).map((c) => <option key={c.id} value={c.id}>{pick(c.name, locale)}</option>)}</select>
      </label>
      {guides.isPending ? <Skeleton className="h-64" /> : !guides.data?.length ? <EmptyState icon={BookOpen} title={t("noGuides")} /> : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {guides.data.map((g) => (
            <li key={g.id}><Link href={`/app/tools/guides/${g.id}`} className="block h-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className="h-full space-y-1 hover:shadow-md">
                <p className="text-xs font-medium text-brand">{name(g.commodityId)}</p>
                <p className="font-semibold">{g.title}</p>
                <p className="line-clamp-3 text-sm text-muted-fg">{g.summary}</p>
                {g.updatedAt ? <p className="text-xs text-muted-fg">{t("updated", { date: fmtDate(g.updatedAt, locale) })}</p> : null}
              </Card>
            </Link></li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GuideDetail({ id }: { id: string }) {
  const t = useTranslations("tools");
  const locale = useLocale();
  const guide = useCropGuide(id);
  if (guide.isPending) return <Skeleton className="h-96" />;
  if (guide.isError || !guide.data) return <EmptyState icon={BookOpen} title={t("noGuides")} />;
  const g = guide.data;
  return (
    <article className="max-w-3xl space-y-5">
      <Link href="/app/tools/guides" className="text-sm font-semibold text-brand hover:underline">← {t("guides")}</Link>
      <header>
        <h1 className="text-2xl font-bold">{g.title}</h1>
        {g.summary ? <p className="mt-1 text-muted-fg">{g.summary}</p> : null}
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-fg">
          {g.reviewedAt ? <span className="inline-flex items-center gap-1 text-up-ink"><BadgeCheck aria-hidden className="size-4" />{t("reviewedShort")}</span> : null}
          {g.updatedAt ? <span>{t("updated", { date: fmtDate(g.updatedAt, locale) })}</span> : null}
        </p>
      </header>
      {g.sections?.length && g.sections.length > 2 ? (
        <nav aria-label={g.title} className="rounded-xl bg-muted p-3 text-sm"><ol className="list-decimal space-y-0.5 ps-5">{g.sections.map((s) => <li key={s.key}><a href={`#g-${s.key}`} className="text-brand hover:underline">{s.title}</a></li>)}</ol></nav>
      ) : null}
      {(g.sections ?? []).map((s) => (
        <section key={s.key} id={`g-${s.key}`} className="scroll-mt-20"><h2 className="text-xl font-semibold">{s.title}</h2><Markdown source={s.body ?? ""} /></section>
      ))}
    </article>
  );
}

// ── Programmes & training ──
export function Programmes() {
  const t = useTranslations("tools");
  const locale = useLocale();
  const me = useMe();
  const [f, setF] = useQueryStates({ open: parseAsBoolean.withDefault(true) });
  const list = useProgrammes(me.data?.country ?? "", f.open || undefined);
  return (
    <div className="space-y-5">
      <PageTitle title={t("programmes")} subtitle={t("programmesBody")} />
      <RangeTabs size="sm" label={t("programmes")} value={f.open ? "open" : "all"} onChange={(v) => void setF({ open: v === "open" ? null : false })} options={[{ value: "open", label: t("openOnly") }, { value: "all", label: t("allProgrammes") }]} />
      {list.isPending ? <Skeleton className="h-64" /> : !list.data?.length ? <EmptyState icon={Landmark} title={t("noProgrammes")} /> : (
        <ul className="space-y-4">
          {list.data.map((p) => (
            <li key={p.id}><Card className="space-y-2">
              <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{p.title}</h2>{p.open ? <Badge tone="up">{t("openOnly")}</Badge> : null}</div>
              <p className="text-xs text-muted-fg">{[p.agency ? t("agency", { agency: p.agency }) : null, p.opensAt ? t("opens", { date: fmtDate(p.opensAt, locale) }) : null, p.closesAt ? t("closes", { date: fmtDate(p.closesAt, locale) }) : null].filter(Boolean).join(" · ")}</p>
              {p.body ? <Markdown source={p.body} className="text-sm" /> : null}
              {p.eligibility ? <div className="text-sm"><p className="font-medium">{t("eligibility")}</p><Markdown source={p.eligibility} /></div> : null}
              {isHttp(p.url) ? <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">{t("apply")}<ExternalLink aria-hidden className="size-3.5" /></a> : null}
            </Card></li>
          ))}
        </ul>
      )}
    </div>
  );
}

const TKINDS = ["all", "article", "event", "video", "course"] as const;
export function Training() {
  const t = useTranslations("tools");
  const locale = useLocale();
  const me = useMe();
  const [f, setF] = useQueryStates({ kind: parseAsStringLiteral(TKINDS).withDefault("all"), upcoming: parseAsBoolean.withDefault(false) });
  const list = useTraining(me.data?.country ?? "", f.kind === "all" ? undefined : f.kind, f.upcoming || undefined);
  return (
    <div className="space-y-5">
      <PageTitle title={t("training")} subtitle={t("trainingBody")} />
      <div className="flex flex-wrap items-center gap-4">
        <RangeTabs size="sm" label={t("kind")} value={f.kind} onChange={(v) => void setF({ kind: v === "all" ? null : v })} options={TKINDS.map((k) => ({ value: k, label: t(`tk_${k}`) }))} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.upcoming} onChange={(e) => void setF({ upcoming: e.target.checked || null })} className="size-4 accent-brand" />{t("upcoming")}</label>
      </div>
      {list.isPending ? <Skeleton className="h-64" /> : !list.data?.length ? <EmptyState icon={GraduationCap} title={t("noTraining")} /> : (
        <ul className="grid gap-4 md:grid-cols-2">
          {list.data.map((x) => (
            <li key={x.id}><Card className="h-full space-y-2">
              <Badge>{t.has(`tk_${x.kind}`) ? t(`tk_${x.kind}`) : x.kind}</Badge>
              <h2 className="font-semibold">{x.title}</h2>
              {x.startsAt ? <p className="flex items-center gap-1 text-xs text-muted-fg"><CalendarDays aria-hidden className="size-3.5" />{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(x.startsAt))}</p> : null}
              {x.venue ? <p className="flex items-center gap-1 text-xs text-muted-fg"><MapPin aria-hidden className="size-3.5" />{t("venue", { venue: x.venue })}</p> : null}
              {x.body ? <p className="line-clamp-4 text-sm">{x.body}</p> : null}
              {isHttp(x.url) ? <a href={x.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">{t("open")}<ExternalLink aria-hidden className="size-3.5" /></a> : null}
            </Card></li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Suppliers ──
const CATS: SupplierCategory[] = ["seed", "fertiliser", "agrochemical", "equipment", "feed", "veterinary", "irrigation", "packaging"];
/** tel: and wa.me links from free-text numbers: digits only (and a leading +); null when too short (exported for tests). */
export function phoneLinks(raw: string | null | undefined): { tel: string; wa: string } | null {
  if (!raw) return null;
  const plus = raw.trim().startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return { tel: `tel:${plus ? "+" : ""}${digits}`, wa: `https://wa.me/${digits}` };
}

export function Suppliers() {
  const t = useTranslations("tools");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const origin = useOrigin(cc);
  const [f, setF] = useQueryStates({ category: parseAsStringLiteral(CATS) });
  const list = useSuppliers(cc, { category: f.category ?? undefined, lat: origin.lat, lng: origin.lng });
  return (
    <div className="space-y-5">
      <PageTitle title={t("suppliers")} subtitle={t("suppliersBody")} />
      <Card className="space-y-4">
        <LocationPicker origin={origin} idPrefix="sup" />
        <label className="flex max-w-xs flex-col gap-1 text-xs font-medium text-muted-fg">{t("category")}
          <select value={f.category ?? ""} onChange={(e) => void setF({ category: (e.target.value || null) as SupplierCategory | null })} className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground"><option value="">{t("anyCategory")}</option>{CATS.map((c) => <option key={c} value={c}>{t(`c_${c}`)}</option>)}</select>
        </label>
      </Card>
      {list.isPending ? <Skeleton className="h-64" /> : !list.data?.length ? <EmptyState icon={Truck} title={t("noSuppliers")} /> : (
        <ul className="grid gap-4 md:grid-cols-2">
          {list.data.map((s) => {
            const phone = phoneLinks(s.phone), wa = phoneLinks(s.whatsapp ?? s.phone);
            return (
              <li key={s.id}><Card className="h-full space-y-2">
                <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{s.name}</h2>{s.verified ? <Badge tone="brand"><BadgeCheck aria-hidden className="size-3.5" />{t("verified")}</Badge> : null}{s.distanceKm != null ? <span className="ms-auto text-xs text-muted-fg">{t("km", { km: number(s.distanceKm, locale, { digits: 1 }) })}</span> : null}</div>
                {s.categories?.length ? <p className="text-xs text-muted-fg">{s.categories.map((c) => (t.has(`c_${c}`) ? t(`c_${c}`) : c)).join(" · ")}</p> : null}
                {s.description ? <p className="line-clamp-3 text-sm">{s.description}</p> : null}
                <p className="flex flex-wrap gap-3 pt-1 text-sm font-semibold text-brand">
                  {phone ? <a href={phone.tel} className="inline-flex items-center gap-1 hover:underline"><Phone aria-hidden className="size-4" />{t("call")}</a> : null}
                  {s.whatsapp && wa ? <a href={wa.wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline"><MessageCircle aria-hidden className="size-4" />{t("whatsapp")}</a> : null}
                  {isHttp(s.website) ? <a href={s.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline"><ExternalLink aria-hidden className="size-4" />{t("website")}</a> : null}
                  {s.sellerId ? <Link href={`/app/marketplace?q=${encodeURIComponent(s.name ?? "")}`} className="inline-flex items-center gap-1 hover:underline">{t("shop")}</Link> : null}
                </p>
              </Card></li>
            );
          })}
        </ul>
      )}
    </div>
  );
}


