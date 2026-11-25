"use client";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { AlertDialog, Toast } from "radix-ui";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { buttonVariants } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type Tone = "success" | "error";
interface Options { title?: string; actionLabel?: string; onAction?: () => void; duration?: number }
interface Item extends Options { id: number; tone: Tone; text: string; open: boolean }
interface ConfirmOptions { title: string; description: string; confirmLabel: string; cancelLabel?: string; destructive?: boolean }
interface Feedback {
  success: (text: string, opts?: Options) => void;
  error: (text: string, opts?: Options) => void;
  /** Blocking confirmation for destructive or irreversible actions (never a toast). Resolves true on confirm. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const Ctx = createContext<Feedback | null>(null);
const MAX_VISIBLE = 3;
// Errors stay longer and carry the fix; both pause while hovered or focused (Radix), and F8 jumps to them.
const DURATION: Record<Tone, number> = { success: 4500, error: 8000 };

/**
 * App-wide feedback for action outcomes (signed in failed, alert created, password updated…) as animated toasts,
 * plus a confirm() dialog for destructive actions. Field validation stays inline next to its input, and failed
 * page loads keep their inline retry. Toasts are announced politely (success) or assertively (error) by Radix.
 */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("feedback");
  const [items, setItems] = useState<Item[]>([]);
  const seq = useRef(0);
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);

  const push = useCallback((tone: Tone) => (text: string, opts?: Options) => {
    const id = ++seq.current;
    setItems((list) => [...list.filter((i) => i.open).slice(-(MAX_VISIBLE - 1)), { id, tone, text, open: true, ...opts }]);
  }, []);
  const close = (id: number) => setItems((list) => list.map((i) => (i.id === id ? { ...i, open: false } : i)));
  // Drop closed toasts once their exit animation has played.
  const remove = (id: number) => setTimeout(() => setItems((list) => list.filter((i) => i.id !== id || i.open)), 300);

  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirmState({ ...opts, resolve })), []);
  const api = useMemo<Feedback>(() => ({ success: push("success"), error: push("error"), confirm }), [push, confirm]);
  const settle = (v: boolean) => { confirmState?.resolve(v); setConfirmState(null); };

  return (
    <Ctx.Provider value={api}>
      <Toast.Provider swipeDirection="right" label={t("toastLabel")}>
        {children}

        {items.map((i) => {
          const Icon = i.tone === "success" ? CircleCheck : CircleAlert;
          const duration = i.duration ?? (i.onAction ? DURATION.error + 4000 : DURATION[i.tone]);
          return (
            <Toast.Root
              key={i.id} open={i.open} duration={duration} type={i.tone === "error" ? "foreground" : "background"}
              onOpenChange={(o) => { if (!o) { close(i.id); remove(i.id); } }}
              style={{ ["--toast-duration" as string]: `${duration}ms` }}
              className={cn(
                "toast group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-2xl border bg-card/95 p-4 pe-10 shadow-lg shadow-black/10 backdrop-blur",
                "ring-1 ring-black/5 dark:shadow-black/40 dark:ring-white/5",
                i.tone === "success" ? "border-up/30" : "border-down/30",
              )}
            >
              <span aria-hidden className={cn("absolute inset-y-0 start-0 w-1", i.tone === "success" ? "bg-up" : "bg-down")} />
              <span aria-hidden className={cn("toast-icon grid size-9 shrink-0 place-items-center rounded-full", i.tone === "success" ? "bg-up/10 text-up-ink" : "bg-down/10 text-down-ink")}>
                <Icon className="size-5" />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <Toast.Title className="text-sm font-semibold">{i.title ?? (i.tone === "success" ? t("successTitle") : t("errorTitle"))}</Toast.Title>
                <Toast.Description className="mt-0.5 text-sm text-muted-fg">{i.text}</Toast.Description>
                {i.onAction && i.actionLabel ? (
                  <Toast.Action altText={i.actionLabel} asChild>
                    <button type="button" onClick={() => i.onAction?.()} className={cn(buttonVariants({ size: "sm", variant: "outline" }), "mt-3")}>{i.actionLabel}</button>
                  </Toast.Action>
                ) : null}
              </div>
              <Toast.Close aria-label={t("close")} className="absolute end-2 top-2 rounded-lg p-1.5 text-muted-fg opacity-70 transition hover:bg-muted hover:opacity-100 focus-visible:opacity-100">
                <X aria-hidden className="size-4" />
              </Toast.Close>
              {/* Time left; pauses with the timer on hover/focus. Hidden for reduced motion. */}
              <span aria-hidden className={cn("toast-progress absolute inset-x-0 bottom-0 h-0.5 origin-left rtl:origin-right motion-reduce:hidden", i.tone === "success" ? "bg-up/60" : "bg-down/60")} />
            </Toast.Root>
          );
        })}

        {/* Raw: Radix fills {hotkey} (F8); next-intl must not treat it as a variable. */}
        <Toast.Viewport label={t.raw("notifications") as string} className="fixed inset-x-0 top-0 z-[60] m-0 flex max-h-screen list-none flex-col gap-2 p-4 outline-none sm:inset-x-auto sm:end-0 sm:bottom-0 sm:top-auto sm:w-[400px] sm:flex-col-reverse" />
      </Toast.Provider>

      <AlertDialog.Root open={!!confirmState} onOpenChange={(o) => { if (!o) settle(false); }}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-black/40" />
          <AlertDialog.Content className="dialog-content fixed inset-0 z-50 m-auto h-fit w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl focus:outline-none">
            {confirmState ? (
              <>
                <AlertDialog.Title className="font-semibold">{confirmState.title}</AlertDialog.Title>
                <AlertDialog.Description className="mt-1 text-sm text-muted-fg">{confirmState.description}</AlertDialog.Description>
                <div className="mt-6 flex justify-end gap-2">
                  <AlertDialog.Cancel className={buttonVariants({ variant: "ghost", size: "sm" })}>{confirmState.cancelLabel ?? t("cancel")}</AlertDialog.Cancel>
                  <AlertDialog.Action onClick={() => settle(true)} className={cn(buttonVariants({ size: "sm" }), confirmState.destructive && "bg-down text-white hover:bg-down/90")}>
                    {confirmState.confirmLabel}
                  </AlertDialog.Action>
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
