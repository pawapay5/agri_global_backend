"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { Button, FieldError, Input, Label } from "@/components/ui/primitives";
import { z } from "@/lib/zod";

export const ALERT_CHANNELS = ["in_app", "push", "email", "sms", "whatsapp"] as const;
export const alertSchema = z.object({
  commodityId: z.string().min(1),
  marketId: z.string().optional(),
  condition: z.enum(["above", "below", "pct_change"]),
  threshold: z.string().regex(/^-?\d{1,9}(\.\d{1,2})?$/),
  channels: z.array(z.enum(ALERT_CHANNELS)).min(1),
});
export type AlertFormValues = z.infer<typeof alertSchema>;
type Option = { id: string; label: string };

/**
 * Price-alert form (React Hook Form + zod). Pure UI: options and submission come from the caller, which
 * maps values to the API's AlertCreate. Errors are inline next to each field; the outcome (created / failed)
 * belongs to the app-wide feedback dialog. `currencyUnit` labels the threshold, e.g. "GHS/kg".
 */
export function AlertForm({ commodities, markets, onSubmit, pending, currencyUnit, defaultValues }: {
  commodities: Option[]; markets: Option[]; onSubmit: (v: AlertFormValues) => Promise<void> | void;
  pending?: boolean; currencyUnit?: string; defaultValues?: Partial<AlertFormValues>;
}) {
  const t = useTranslations("ds");
  const f = useForm<AlertFormValues>({
    resolver: zodResolver(alertSchema),
    defaultValues: { condition: "below", channels: ["in_app", "push"], marketId: "", threshold: "", ...defaultValues },
  });
  const condition = useWatch({ control: f.control, name: "condition" });
  const e = f.formState.errors;
  const select = "h-11 w-full rounded-xl border border-border bg-card px-3 text-sm aria-[invalid=true]:border-down";

  return (
    <form noValidate className="space-y-4" onSubmit={f.handleSubmit(async (v) => {
      try { await onSubmit(v); f.reset({ ...v, threshold: "" }); }
      catch { /* the caller reported the failure; keep the values so the user can fix and resubmit */ }
    })}>
      <div className="space-y-1.5">
        <Label htmlFor="af-commodity">{t("commodity")}</Label>
        <select id="af-commodity" {...f.register("commodityId")} aria-invalid={!!e.commodityId} aria-describedby={e.commodityId ? "af-commodity-err" : undefined} className={select}>
          <option value="">{t("pickCommodity")}</option>
          {commodities.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <FieldError><span id="af-commodity-err">{e.commodityId ? t("pickCommodity") : null}</span></FieldError>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="af-market">{t("market")}</Label>
        <select id="af-market" {...f.register("marketId")} className={select}>
          <option value="">{t("allMarkets")}</option>
          {markets.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("condition")}</legend>
        {(["below", "above", "pct_change"] as const).map((c) => (
          <label key={c} className="flex items-center gap-2 text-sm">
            <input type="radio" value={c} {...f.register("condition")} className="size-4 accent-[var(--brand)]" />
            {t(c === "pct_change" ? "pctChange" : c)}
          </label>
        ))}
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="af-threshold">{t("threshold")} {condition === "pct_change" ? "(%)" : currencyUnit ? `(${currencyUnit})` : ""}</Label>
        <Input id="af-threshold" inputMode="decimal" autoComplete="off" {...f.register("threshold")} aria-invalid={!!e.threshold} aria-describedby={e.threshold ? "af-threshold-err" : undefined} />
        <FieldError><span id="af-threshold-err">{e.threshold ? t("enterNumber") : null}</span></FieldError>
      </div>

      <fieldset className="space-y-2" aria-describedby={e.channels ? "af-channels-err" : undefined}>
        <legend className="text-sm font-medium">{t("channels")}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {ALERT_CHANNELS.map((c) => (
            <label key={c} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" value={c} {...f.register("channels")} className="size-4 accent-[var(--brand)]" />{t(`ch_${c}`)}
            </label>
          ))}
        </div>
        <FieldError><span id="af-channels-err">{e.channels ? t("pickChannel") : null}</span></FieldError>
      </fieldset>

      <Button type="submit" className="w-full" disabled={pending || f.formState.isSubmitting}>{t("createAlert")}</Button>
    </form>
  );
}
