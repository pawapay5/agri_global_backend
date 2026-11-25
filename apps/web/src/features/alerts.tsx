"use client";
import { Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useFeedback } from "@/components/feedback/feedback";
import { AlertForm, type AlertFormValues } from "@/components/agri/alert-form";
import { Badge, Card, CardTitle } from "@/components/ui/primitives";
import { useAlertInsights, useAlerts, useCommodities, useCreateAlert, useDeleteAlert, useMarkets, useMe, useUpdateAlert } from "@/lib/api/queries";
import { ApiError } from "@/lib/api/browser";
import { formatDate, pick } from "@/lib/utils";
import { PageTitle, QueryState } from "./common";


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
  const name = (id: string) => pick(commodities.data?.data.find((c) => c.id === id)?.name, locale);
  const marketName = (id?: string) => (id ? pick(markets.data?.data.find((m) => m.id === id)?.name, locale) : t("allMarkets"));

  const onSubmit = async (v: AlertFormValues) => {
    try {
      await create.mutateAsync({ commodityId: v.commodityId, marketId: v.marketId || undefined, condition: v.condition, threshold: v.threshold, channels: v.channels, priceType: "wholesale", pctWindowDays: 7, cooldownHours: 24, active: true });
      feedback.success(t("alertCreated"));
    } catch (e) {
      failed(e);
      throw e; // keep the form's values so the user can fix and resubmit
    }
  };

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
          <div className="mt-4">
            <AlertForm
              commodities={(commodities.data?.data ?? []).map((c) => ({ id: c.id, label: pick(c.name, locale) }))}
              markets={(markets.data?.data ?? []).map((m) => ({ id: m.id, label: pick(m.name, locale) }))}
              onSubmit={onSubmit}
              pending={create.isPending}
            />
          </div>
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
