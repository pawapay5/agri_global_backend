"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { z } from "@/lib/zod";
import { useFeedback } from "@/components/feedback/feedback";
import { Badge, Button, Card, CardTitle, FieldError, Input, Label } from "@/components/ui/primitives";
import { useAlertInsights, useAlerts, useCommodities, useCreateAlert, useDeleteAlert, useMarkets, useMe, useUpdateAlert } from "@/lib/api/queries";
import { ApiError } from "@/lib/api/browser";
import { formatDate, pick } from "@/lib/utils";
import { PageTitle, QueryState } from "./common";

const CHANNELS = ["in_app", "push", "email", "sms", "whatsapp"] as const;
const schema = z.object({
  commodityId: z.uuid(),
  marketId: z.string().optional(),
  condition: z.enum(["above", "below", "pct_change"]),
  threshold: z.string().regex(/^-?\d{1,9}(\.\d{1,2})?$/, "Enter a number"),
  channels: z.array(z.enum(CHANNELS)).min(1, "Pick at least one channel"),
});
type Values = z.infer<typeof schema>;

export function AlertsPage() {
  const t = useTranslations("app");
  const locale = useLocale();
  const me = useMe();
  const cc = me.data?.country ?? "";
  const alerts = useAlerts();
  const insights = useAlertInsights();
  const commodities = useCommodities(cc);
  const markets = useMarkets(cc);
  const create = useCreateAlert(), update = useUpdateAlert(), remove = useDeleteAlert();
  const feedback = useFeedback();
  const failed = (e: unknown) => feedback.error(e instanceof ApiError ? e.detail ?? e.code : t("error"));
  const f = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { condition: "below", channels: ["in_app", "push"] } });
  const conditionValue = useWatch({ control: f.control, name: "condition" });
  const name = (id: string) => pick(commodities.data?.data.find((c) => c.id === id)?.name, locale);
  const marketName = (id?: string) => (id ? pick(markets.data?.data.find((m) => m.id === id)?.name, locale) : t("allMarkets"));

  const onSubmit = f.handleSubmit(async (v) => {
    try {
      await create.mutateAsync({ commodityId: v.commodityId, marketId: v.marketId || undefined, condition: v.condition, threshold: v.threshold, channels: v.channels, priceType: "wholesale", pctWindowDays: 7, cooldownHours: 24, active: true });
      f.reset({ ...v, threshold: "" });
      feedback.success(t("alertCreated"));
    } catch (e) {
      failed(e);
    }
  });

  return (
    <div className="space-y-6">
      <PageTitle title={t("alerts")} />
      <QueryState q={insights}>
        {(i) => (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {([["Active", i.activeAlerts], ["Triggered (30 days)", i.triggered30d], ["Above target", i.aboveCount], ["Below target", i.belowCount]] as const).map(([k, v]) => (
              <Card key={k}><p className="text-2xl font-bold tabular">{v}</p><p className="text-xs text-muted-fg">{k}</p></Card>
            ))}
          </div>
        )}
      </QueryState>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardTitle>{t("createAlert")}</CardTitle>
          <form onSubmit={onSubmit} className="mt-4 space-y-4" noValidate>
            <div className="space-y-1.5"><Label htmlFor="commodity">{t("selectCommodity")}</Label>
              <select id="commodity" {...f.register("commodityId")} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm">
                <option value="">—</option>{commodities.data?.data.map((c) => <option key={c.id} value={c.id}>{pick(c.name, locale)}</option>)}
              </select><FieldError>{f.formState.errors.commodityId && t("selectCommodity")}</FieldError></div>
            <div className="space-y-1.5"><Label htmlFor="market">{t("selectMarket")}</Label>
              <select id="market" {...f.register("marketId")} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm">
                <option value="">{t("allMarkets")}</option>{markets.data?.data.map((m) => <option key={m.id} value={m.id}>{pick(m.name, locale)}</option>)}
              </select></div>
            <fieldset className="space-y-2"><legend className="text-sm font-medium">Condition</legend>
              {(["above", "below", "pct_change"] as const).map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm"><input type="radio" value={c} {...f.register("condition")} className="accent-[var(--brand)]" />{t(c === "pct_change" ? "pctChange" : c)}</label>
              ))}
            </fieldset>
            <div className="space-y-1.5"><Label htmlFor="threshold">{t("threshold")}{conditionValue === "pct_change" ? " (%)" : ""}</Label>
              <Input id="threshold" inputMode="decimal" {...f.register("threshold")} /><FieldError>{f.formState.errors.threshold?.message}</FieldError></div>
            <fieldset className="space-y-2"><legend className="text-sm font-medium">{t("channels")}</legend>
              <div className="flex flex-wrap gap-3">{CHANNELS.map((c) => <label key={c} className="flex items-center gap-1.5 text-sm capitalize"><input type="checkbox" value={c} {...f.register("channels")} className="accent-[var(--brand)]" />{c.replace("_", "-")}</label>)}</div>
              <FieldError>{f.formState.errors.channels?.message}</FieldError>
            </fieldset>
            <Button type="submit" className="w-full" disabled={create.isPending}>{t("createAlert")}</Button>
          </form>
        </Card>

        <Card className="lg:col-span-3">
          <QueryState q={alerts}>
            {(list) => !list.length ? <p className="text-sm text-muted-fg">{t("noAlerts")}</p> : (
              <ul className="divide-y divide-border">
                {list.map((a) => (
                  <li key={a.id} className="flex items-center gap-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{name(a.commodityId)} · <span className="font-normal text-muted-fg">{marketName(a.marketId)}</span></p>
                      <p className="text-sm">{t(a.condition === "pct_change" ? "pctChange" : a.condition)} <span className="font-semibold tabular">{a.threshold}{a.condition === "pct_change" ? "%" : ` ${a.thresholdCurrency ?? ""}/${a.thresholdUnit ?? ""}`}</span></p>
                      <p className="text-xs text-muted-fg">{a.channels.join(", ")} · {formatDate(a.createdAt, locale)}{a.triggerCount ? ` · ${a.triggerCount}×` : ""}</p>
                    </div>
                    <label className="flex items-center gap-2 text-xs"><input type="checkbox" role="switch" checked={a.active ?? true} onChange={(e) => update.mutate({ id: a.id, body: { active: e.target.checked } }, { onError: failed })} className="accent-[var(--brand)]" />{a.active ? <Badge tone="up">On</Badge> : <Badge>Off</Badge>}</label>
                    <button aria-label={t("delete")} onClick={() => remove.mutate(a.id, { onSuccess: () => feedback.success(t("alertDeleted")), onError: failed })} className="rounded-lg p-2 text-down hover:bg-down/10"><Trash2 className="size-4" /></button>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </Card>
      </div>
    </div>
  );
}
