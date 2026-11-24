"use client";
import { CircleAlert, CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { AlertDialog } from "radix-ui";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { buttonVariants } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type Tone = "success" | "error";
interface Options { title?: string; actionLabel?: string; onAction?: () => void }
interface Message extends Options { tone: Tone; text: string }
interface Feedback {
  success: (text: string, opts?: Options) => void;
  error: (text: string, opts?: Options) => void;
}

const Ctx = createContext<Feedback | null>(null);

/**
 * One app-wide alert dialog for action outcomes (sign-in failed, password updated, alert created…).
 * Field validation stays inline next to its input, and failed page loads keep their inline retry,
 * so the dialog is only used when the user has just done something and needs to know the result.
 */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("feedback");
  const [msg, setMsg] = useState<Message | null>(null);
  const [open, setOpen] = useState(false);
  const pending = useRef<(() => void) | undefined>(undefined);

  const show = useCallback((tone: Tone) => (text: string, opts?: Options) => { setMsg({ tone, text, ...opts }); setOpen(true); }, []);
  const api = useMemo<Feedback>(() => ({ success: show("success"), error: show("error") }), [show]);

  const close = (runAction: boolean) => {
    pending.current = runAction ? msg?.onAction : undefined;
    setOpen(false);
  };

  const Icon = msg?.tone === "success" ? CircleCheck : CircleAlert;
  return (
    <Ctx.Provider value={api}>
      {children}
      <AlertDialog.Root open={open} onOpenChange={(o) => { if (!o) close(false); }}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <AlertDialog.Content
            onCloseAutoFocus={() => { const run = pending.current; pending.current = undefined; run?.(); }}
            className="fixed inset-0 z-50 m-auto h-fit w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl focus:outline-none"
          >
            {msg ? (
              <>
                <div className="flex items-start gap-3">
                  <Icon aria-hidden className={cn("mt-0.5 size-6 shrink-0", msg.tone === "success" ? "text-up" : "text-down")} />
                  <div className="min-w-0 space-y-1">
                    <AlertDialog.Title className="font-semibold">{msg.title ?? (msg.tone === "success" ? t("successTitle") : t("errorTitle"))}</AlertDialog.Title>
                    <AlertDialog.Description className="text-sm text-muted-fg">{msg.text}</AlertDialog.Description>
                  </div>
                </div>
                <div className="mt-6 flex justify-end gap-2">
                  {msg.onAction ? (
                    <>
                      <AlertDialog.Cancel className={buttonVariants({ variant: "ghost", size: "sm" })}>{t("close")}</AlertDialog.Cancel>
                      <AlertDialog.Action className={buttonVariants({ size: "sm" })} onClick={() => close(true)}>{msg.actionLabel ?? t("ok")}</AlertDialog.Action>
                    </>
                  ) : (
                    <AlertDialog.Action className={buttonVariants({ size: "sm" })}>{t("ok")}</AlertDialog.Action>
                  )}
                </div>
              </>
            ) : null}
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </Ctx.Provider>
  );
}

export function useFeedback(): Feedback {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useFeedback must be used inside <FeedbackProvider>");
  return ctx;
}

/** Turns a problem `code` from the API into the localised auth message, with a generic fallback. */
export function useProblemMessage() {
  const t = useTranslations("auth");
  return useCallback((code?: string) => (code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.generic")), [t]);
}
