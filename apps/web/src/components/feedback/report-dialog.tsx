"use client";
import { Flag, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { useState, type ReactNode } from "react";
import { Button, Label } from "@/components/ui/primitives";
import type { S } from "@/lib/api/browser";
import { useReportAbuse } from "@/lib/api/market";
import { useFeedback, useProblemMessage } from "./feedback";

const REASONS = ["scam", "spam", "harassment", "inappropriate", "wrong_price", "counterfeit", "other"] as const;

/**
 * "Report" for a listing, message or user: a small dialog with a reason and optional details, sent to the
 * moderation queue. The trigger is passed in so it can be a menu item, an icon or a text link.
 */
export function ReportDialog({ targetType, targetId, trigger }: { targetType: "listing" | "message" | "user" | "post" | "comment"; targetId: string; trigger: ReactNode }) {
  const t = useTranslations("rpt");
  const fb = useFeedback();
  const problem = useProblemMessage();
  const report = useReportAbuse();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]>("scam");
  const [details, setDetails] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: S["AbuseReport"] = { targetType, targetId, reason, ...(details.trim() ? { details: details.trim().slice(0, 2000) } : {}) };
    report.mutate(body, {
      onSuccess: () => { setOpen(false); setDetails(""); fb.success(t("sent")); },
      onError: (x) => fb.error(problem(x as never)),
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content className="fixed start-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-5 shadow-xl outline-none rtl:translate-x-1/2">
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="flex items-center gap-2 text-lg font-semibold"><Flag aria-hidden className="size-5 text-down" />{t("title", { what: t(`what_${targetType}`) })}</Dialog.Title>
            <Dialog.Close className="rounded-lg p-1 hover:bg-muted" aria-label={t("cancel")}><X className="size-4" /></Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-sm text-muted-fg">{t("intro")}</Dialog.Description>
          <form onSubmit={submit} className="mt-4 space-y-4">
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">{t("reason")}</legend>
              {REASONS.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm"><input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="size-4 accent-brand" />{t(`reason_${r}`)}</label>
              ))}
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor={`rpt-${targetId}`}>{t("details")}</Label>
              <textarea id={`rpt-${targetId}`} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} rows={3} className="w-full rounded-xl border border-border bg-background p-3 text-sm" />
            </div>
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild><Button type="button" variant="ghost" size="sm">{t("cancel")}</Button></Dialog.Close>
              <Button type="submit" size="sm" disabled={report.isPending}>{t("submit")}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
