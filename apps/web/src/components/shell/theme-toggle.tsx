"use client";
import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

const noSubscribe = () => () => {};

/**
 * Light/dark switch for every navbar. The server can't know the visitor's theme, so until hydration it renders
 * a neutral placeholder of the same size (no layout shift, no hydration mismatch). The label states the action.
 */
export function ThemeToggle({ className, tone = "default" }: { className?: string; tone?: "default" | "onDark" }) {
  const t = useTranslations("ds");
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const dark = mounted && resolvedTheme === "dark";
  const label = dark ? t("themeToLight") : t("themeToDark");
  const base = cn("inline-grid size-10 shrink-0 place-items-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
    tone === "onDark" ? "text-white hover:bg-white/10" : "text-foreground hover:bg-muted", className);
  if (!mounted) return <span aria-hidden className={base} />;
  return (
    <button type="button" onClick={() => setTheme(dark ? "light" : "dark")} aria-label={label} title={label} className={base}>
      <Sun aria-hidden className={cn("size-5 transition-all duration-300", dark ? "rotate-0 scale-100" : "absolute -rotate-90 scale-0")} />
      <Moon aria-hidden className={cn("size-5 transition-all duration-300", dark ? "absolute rotate-90 scale-0" : "rotate-0 scale-100")} />
    </button>
  );
}
