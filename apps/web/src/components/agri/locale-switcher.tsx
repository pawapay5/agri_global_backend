"use client";
import { Globe } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";

/** Each locale in its own language, so a reader can always find theirs. */
const NATIVE: Record<string, string> = { en: "English", fr: "Français", tw: "Twi", ee: "Eʋegbe", gaa: "Gã", ha: "Hausa", sw: "Kiswahili", pt: "Português", ar: "العربية" };

/** Keeps the current page and its search params; next-intl stores the choice in the ap_locale cookie. */
export function LocaleSwitcher({ className }: { className?: string }) {
  const t = useTranslations("ds");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <label className={cn("inline-flex items-center gap-1.5 text-sm", pending && "opacity-60", className)}>
      <Globe aria-hidden className="size-4 text-muted-fg" />
      <span className="sr-only">{t("language")}</span>
      <select
        value={locale}
        onChange={(e) => {
          const next = e.target.value;
          const qs = search.toString();
          start(() => router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { locale: next }));
        }}
        className="h-9 rounded-lg border border-border bg-card px-2"
      >
        {routing.locales.map((l) => <option key={l} value={l} lang={l}>{NATIVE[l] ?? l}</option>)}
      </select>
    </label>
  );
}
