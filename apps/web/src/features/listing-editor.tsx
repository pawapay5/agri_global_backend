"use client";
import { AlertTriangle, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { EmptyState } from "@/components/agri/empty-state";
import { useFeedback, useProblemMessage } from "@/components/feedback/feedback";
import { Badge, Button, Card, CardTitle, FieldError, Input, Label, Skeleton } from "@/components/ui/primitives";
import { Link, useRouter } from "@/i18n/navigation";
import type { S } from "@/lib/api/browser";
import { useCreateListing, useListing, useListingPhotos, useUpdateListing } from "@/lib/api/market";
import { useCommodities, useLatest, useMe } from "@/lib/api/queries";
import { pctPlain } from "@/lib/format";
import { pick } from "@/lib/utils";
import { IMAGE_ACCEPT, isHttp, MAX_UPLOAD_MB, tooBig } from "./market-common";

type Draft = {
  type: "product" | "service"; serviceKind: "transport" | "storage" | "input_supply"; commodityId: string; title: string; description: string;
  pricePerUnit: string; currency: string; unit: string; quantity: string; minOrderQty: string; lowStockThreshold: string; qualityGrade: "" | "A" | "B" | "C" | "ungraded"; harvestDate: string;
};
export type DraftErrors = Partial<Record<keyof Draft, "required" | "badNumber" | "tooLong">>;
const UNITS = ["kg", "bag_50kg", "bag_100kg", "crate", "t", "each", "bunch", "litre", "trip", "day"];
const pos = (v: string) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) > 0;

/** Mirrors ListingCreate's limits so most mistakes are caught before the round trip (exported for tests). */
export function validateListing(d: Draft): DraftErrors {
  const e: DraftErrors = {};
  if (d.title.trim().length < 3) e.title = "required"; else if (d.title.trim().length > 120) e.title = "tooLong";
  if (d.description.length > 4000) e.description = "tooLong";
  if (!pos(d.pricePerUnit)) e.pricePerUnit = "badNumber";
  if (!pos(d.quantity)) e.quantity = "badNumber";
  if (d.minOrderQty && !pos(d.minOrderQty)) e.minOrderQty = "badNumber";
  if (d.lowStockThreshold && !pos(d.lowStockThreshold)) e.lowStockThreshold = "badNumber";
  if (!/^[A-Z]{3}$/.test(d.currency)) e.currency = "required";
  if (!d.unit.trim()) e.unit = "required";
  return e;
}

/** /app/sell/listings/new and /app/sell/listings/[id]: one form for both; photos once the draft exists. */
export function ListingEditor({ id }: { id?: string }) {
  const t = useTranslations("sell");
  const listing = useListing(id ?? "");
  if (id && listing.isPending) return <Skeleton className="h-96" />;
  if (id && (listing.isError || !listing.data)) return <EmptyState title={t("noListings")} />;
  return <EditorForm key={id ?? "new"} existing={id ? listing.data : undefined} />;
}

function EditorForm({ existing }: { existing?: S["Listing"] }) {
  const t = useTranslations("sell");
  const tm = useTranslations("mp");
  const locale = useLocale();
  const router = useRouter();
  const me = useMe();
  const commodities = useCommodities(me.data?.country ?? "");
  const create = useCreateListing();
  const update = useUpdateListing(existing?.id ?? "");
  const fb = useFeedback();
  const problem = useProblemMessage();
  const [d, setD] = useState<Draft>(() => ({
    type: (existing?.type as Draft["type"]) ?? "product", serviceKind: (existing?.serviceKind as Draft["serviceKind"]) ?? "transport", commodityId: existing?.commodityId ?? "",
    title: existing?.title ?? "", description: existing?.description ?? "", pricePerUnit: existing?.pricePerUnit ?? "", currency: existing?.currency ?? "", unit: existing?.unit ?? "kg",
    quantity: existing?.quantity ?? "", minOrderQty: existing?.minOrderQty ?? "", lowStockThreshold: "", qualityGrade: (existing?.qualityGrade as Draft["qualityGrade"]) ?? "", harvestDate: existing?.harvestDate ?? "",
  }));
  const [errors, setErrors] = useState<DraftErrors>({});
  const latest = useLatest(d.commodityId, me.data?.country ?? "");
  const marketCurrency = latest.data?.[0]?.value.display.currency;
  const currency = d.currency || marketCurrency || "";
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((s) => ({ ...s, [k]: v }));
  const err = (k: keyof Draft) => (errors[k] ? <FieldError><span id={`le-${k}-err`}>{t(errors[k]!)}</span></FieldError> : null);
  const aria = (k: keyof Draft) => ({ "aria-invalid": Boolean(errors[k]), "aria-describedby": errors[k] ? `le-${k}-err` : undefined });

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const full = { ...d, currency };
    const errs = validateListing(full);
    setErrors(errs);
    const first = Object.keys(errs)[0];
    if (first) { document.getElementById(`le-${first}`)?.focus(); return; }
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    if (!existing) {
      create.mutate({
        type: d.type, ...(d.type === "service" ? { serviceKind: d.serviceKind } : {}), ...(d.commodityId ? { commodityId: d.commodityId } : {}),
        title: d.title.trim(), ...(opt(d.description) ? { description: d.description.trim() } : {}), pricePerUnit: d.pricePerUnit.trim(), currency, unit: d.unit.trim(), quantity: d.quantity.trim(),
        ...(opt(d.minOrderQty) ? { minOrderQty: d.minOrderQty.trim() } : {}), ...(opt(d.lowStockThreshold) ? { lowStockThreshold: d.lowStockThreshold.trim() } : {}),
        ...(d.qualityGrade ? { qualityGrade: d.qualityGrade } : {}), ...(d.harvestDate ? { harvestDate: d.harvestDate } : {}),
      }, { onSuccess: (l) => { fb.success(t("draftSaved")); router.replace(`/app/sell/listings/${l.id}`); }, onError: (x) => fb.error(problem(x as never)) });
    } else {
      update.mutate({
        title: d.title.trim(), description: d.description.trim(), pricePerUnit: d.pricePerUnit.trim(), quantity: d.quantity.trim(),
        ...(opt(d.minOrderQty) ? { minOrderQty: d.minOrderQty.trim() } : {}), ...(opt(d.lowStockThreshold) ? { lowStockThreshold: d.lowStockThreshold.trim() } : {}),
        ...(d.qualityGrade ? { qualityGrade: d.qualityGrade } : {}), ...(d.harvestDate ? { harvestDate: d.harvestDate } : {}),
      }, { onSuccess: () => fb.success(t("saved")), onError: (x) => fb.error(problem(x as never)) });
    }
  };
  const setStatus = async (status: "active" | "draft" | "removed") => {
    if (status === "removed" && !(await fb.confirm({ title: t("removeTitle"), description: t("removeBody"), confirmLabel: t("removeListing"), destructive: true }))) return;
    update.mutate({ status }, {
      onSuccess: () => { fb.success(t(status === "active" ? "published" : status === "removed" ? "removed" : "saved")); if (status === "removed") router.push("/app/sell/listings"); },
      onError: (x) => fb.error(problem(x as never)),
    });
  };
  const select = "h-10 w-full rounded-xl border border-border bg-background px-3 text-sm";

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-5">
      <Card className="space-y-4 lg:col-span-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">{existing ? existing.title : t("newListing")}</h1>
          {existing?.status ? <Badge tone={existing.status === "active" ? "up" : "neutral"}>{existing.status === "active" ? t("st_active") : tm(`status_${existing.status}`)}</Badge> : null}
        </div>
        {existing?.priceFlag && existing.priceDeviationPct != null ? (
          <p className="flex items-start gap-2 rounded-xl bg-forecast/10 p-3 text-sm text-forecast-ink"><AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />{t("priceCheck", { pct: `${existing.priceDeviationPct > 0 ? "+" : "−"}${pctPlain(existing.priceDeviationPct, locale, 0)}` })}</p>
        ) : null}
        <form onSubmit={save} noValidate className="space-y-4">
          {!existing ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset className="space-y-1.5"><legend className="text-sm font-medium">{tm("type")}</legend>
                <div className="flex gap-4 pt-1">{(["product", "service"] as const).map((x) => <label key={x} className="flex items-center gap-1.5 text-sm"><input type="radio" checked={d.type === x} onChange={() => set("type", x)} className="size-4 accent-brand" />{tm(`type_${x}`)}</label>)}</div>
              </fieldset>
              {d.type === "service" ? (
                <div className="space-y-1"><Label htmlFor="le-serviceKind">{t("serviceKind")}</Label>
                  <select id="le-serviceKind" value={d.serviceKind} onChange={(e) => set("serviceKind", e.target.value as Draft["serviceKind"])} className={select}>{(["transport", "storage", "input_supply"] as const).map((x) => <option key={x} value={x}>{t(`sk_${x}`)}</option>)}</select>
                </div>
              ) : (
                <div className="space-y-1"><Label htmlFor="le-commodityId">{tm("commodity")}</Label>
                  <select id="le-commodityId" value={d.commodityId} onChange={(e) => set("commodityId", e.target.value)} className={select}>
                    <option value="">—</option>{(commodities.data?.data ?? []).map((c) => <option key={c.id} value={c.id}>{pick(c.name, locale)}</option>)}
                  </select>
                </div>
              )}
            </div>
          ) : null}
          <div className="space-y-1"><Label htmlFor="le-title">{t("title_")}</Label><Input id="le-title" value={d.title} maxLength={120} onChange={(e) => set("title", e.target.value)} {...aria("title")} />{err("title")}</div>
          <div className="space-y-1"><Label htmlFor="le-description">{t("description")}</Label><textarea id="le-description" rows={5} maxLength={4000} value={d.description} onChange={(e) => set("description", e.target.value)} className="w-full rounded-xl border border-border bg-background p-3 text-sm" {...aria("description")} />{err("description")}</div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1"><Label htmlFor="le-pricePerUnit">{t("price")}</Label><Input id="le-pricePerUnit" inputMode="decimal" value={d.pricePerUnit} onChange={(e) => set("pricePerUnit", e.target.value)} {...aria("pricePerUnit")} />{err("pricePerUnit")}</div>
            <div className="space-y-1"><Label htmlFor="le-currency">{t("currency")}</Label><Input id="le-currency" value={currency} maxLength={3} disabled={Boolean(existing)} onChange={(e) => set("currency", e.target.value.toUpperCase())} {...aria("currency")} />{err("currency")}</div>
            <div className="space-y-1"><Label htmlFor="le-unit">{t("unit")}</Label><Input id="le-unit" list="le-units" value={d.unit} maxLength={32} disabled={Boolean(existing)} onChange={(e) => set("unit", e.target.value)} {...aria("unit")} /><datalist id="le-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>{err("unit")}</div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1"><Label htmlFor="le-quantity">{t("quantity")}</Label><Input id="le-quantity" inputMode="decimal" value={d.quantity} onChange={(e) => set("quantity", e.target.value)} {...aria("quantity")} />{err("quantity")}</div>
            <div className="space-y-1"><Label htmlFor="le-minOrderQty">{t("minOrderQty")}</Label><Input id="le-minOrderQty" inputMode="decimal" value={d.minOrderQty} onChange={(e) => set("minOrderQty", e.target.value)} {...aria("minOrderQty")} />{err("minOrderQty")}</div>
            <div className="space-y-1"><Label htmlFor="le-lowStockThreshold">{t("lowStock")}</Label><Input id="le-lowStockThreshold" inputMode="decimal" value={d.lowStockThreshold} onChange={(e) => set("lowStockThreshold", e.target.value)} {...aria("lowStockThreshold")} />{err("lowStockThreshold")}</div>
          </div>
          {d.type === "product" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="le-qualityGrade">{t("grade")}</Label>
                <select id="le-qualityGrade" value={d.qualityGrade} onChange={(e) => set("qualityGrade", e.target.value as Draft["qualityGrade"])} className={select}>
                  <option value="">—</option>{(["A", "B", "C"] as const).map((g) => <option key={g} value={g}>{g}</option>)}<option value="ungraded">{t("grade_ungraded")}</option>
                </select>
              </div>
              <div className="space-y-1"><Label htmlFor="le-harvestDate">{t("harvestDate")}</Label><Input id="le-harvestDate" type="date" value={d.harvestDate} onChange={(e) => set("harvestDate", e.target.value)} /></div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={create.isPending || update.isPending}>{existing ? t("saveChanges") : t("createDraft")}</Button>
            {existing && existing.status === "draft" ? <Button type="button" variant="outline" onClick={() => void setStatus("active")} disabled={update.isPending}>{t("publish")}</Button> : null}
            {existing && existing.status !== "draft" && existing.status !== "removed" ? <Button type="button" variant="outline" onClick={() => void setStatus("draft")} disabled={update.isPending}>{t("unpublish")}</Button> : null}
            {existing && existing.status !== "removed" ? <Button type="button" variant="ghost" className="text-down" onClick={() => void setStatus("removed")} disabled={update.isPending}>{t("removeListing")}</Button> : null}
            {existing ? <Link href={`/app/marketplace/${existing.id}`} className="ms-auto self-center text-sm font-semibold text-brand hover:underline">{tm("title")} →</Link> : null}
          </div>
        </form>
      </Card>
      {existing ? <Photos listing={existing} /> : null}
    </div>
  );
}

function Photos({ listing }: { listing: S["Listing"] }) {
  const t = useTranslations("sell");
  const fb = useFeedback();
  const problem = useProblemMessage();
  const { add, remove } = useListingPhotos(listing.id!);
  const ref = useRef<HTMLInputElement>(null);
  const photos = listing.photos ?? [];
  const onFile = (f?: File) => {
    if (!f) return;
    if (tooBig(f)) { fb.error(t("fileTooBig", { mb: MAX_UPLOAD_MB })); return; }
    add.mutate(f, { onSuccess: () => fb.success(t("photoAdded")), onError: (x) => fb.error(problem(x as never)) });
    if (ref.current) ref.current.value = "";
  };
  return (
    <Card className="h-fit space-y-3 lg:col-span-2">
      <CardTitle>{t("photos", { n: photos.length })}</CardTitle>
      <ul className="grid grid-cols-3 gap-2">
        {photos.map((p, i) => (
          <li key={p.id} className="relative overflow-hidden rounded-lg bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- seller upload from our storage */}
            {isHttp(p.urls?.thumb ?? p.urls?.medium) ? <img src={(p.urls.thumb ?? p.urls.medium)!} alt="" className="aspect-square w-full object-cover" /> : <span className="block aspect-square" />}
            <button type="button" onClick={() => remove.mutate(p.id!, { onSuccess: () => fb.success(t("photoRemoved")), onError: (x) => fb.error(problem(x as never)) })}
              aria-label={t("removePhoto", { n: i + 1 })} className="absolute end-1 top-1 rounded-full bg-card/90 p-1.5 text-down shadow"><Trash2 className="size-3.5" /></button>
          </li>
        ))}
      </ul>
      {photos.length < 5 ? (
        <>
          <input ref={ref} id="le-photo" type="file" accept={IMAGE_ACCEPT} className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          <label htmlFor="le-photo" className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted">
            {add.isPending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <ImagePlus aria-hidden className="size-4" />}{t("addPhoto")}
          </label>
        </>
      ) : null}
      <p className="text-xs text-muted-fg">{t("photoHint", { mb: MAX_UPLOAD_MB })}</p>
    </Card>
  );
}
