"use client";
import { BarChart3, Flame, Map as MapIcon, Navigation } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsString, useQueryState } from "nuqs";
import { Link, usePathname } from "@/i18n/navigation";
import { useCommodities, useInterests } from "@/lib/api/queries";
import { cn, pick } from "@/lib/utils";

const VIEWS = [
  { href: "/app/markets", key: "compare", icon: BarChart3 },
  { href: "/app/markets/map", key: "map", icon: MapIcon },
  { href: "/app/markets/heatmap", key: "heatmap", icon: Flame },
  { href: "/app/markets/nearby", key: "nearby", icon: Navigation },
] as const;

/** Sub-navigation shared by every /app/markets view; keeps the chosen commodity when switching views. */
export function MarketsNav() {
  const t = useTranslations("mkt");
  const path = usePathname();
  const [commodity] = useQueryState("commodity", parseAsString);
  return (
    <nav aria-label={t("sections")} className="-mx-1 mb-6 overflow-x-auto px-1">
      <ul className="inline-flex gap-1 rounded-xl bg-muted p-1">
        {VIEWS.map(({ href, key, icon: Icon }) => {
          const on = path === href;
          return (
            <li key={key}>
              <Link href={commodity ? `${href}?commodity=${commodity}` : href} aria-current={on ? "page" : undefined}
                className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "bg-card text-foreground shadow-sm" : "text-muted-fg hover:text-foreground")}>
                <Icon aria-hidden className="size-4" />{t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Commodity choice in the URL (?commodity=). Defaults to the first crop the user follows, then the first in the
 * catalogue. With `optional`, "none" is an explicit choice (locations only, no prices).
 */
export function useCommodityChoice(cc: string, { optional = false } = {}) {
  const commodities = useCommodities(cc);
  const interests = useInterests();
  const [param, setParam] = useQueryState("commodity", parseAsString);
  const list = commodities.data?.data ?? [];
  const followed = interests.data?.commodityIds?.find((id) => list.some((c) => c.id === id));
  const id = param === "none" && optional ? "" : param && list.some((c) => c.id === param) ? param : followed ?? list[0]?.id ?? "";
  return { id, list, set: (v: string) => setParam(v || (optional ? "none" : null)), ready: commodities.isSuccess };
}

export function CommodityPicker({ choice, optional = false, className }: { choice: ReturnType<typeof useCommodityChoice>; optional?: boolean; className?: string }) {
  const t = useTranslations("mkt");
  const locale = useLocale();
  return (
    <label className={cn("flex flex-col gap-1 text-xs font-medium text-muted-fg", className)}>
      {t("commodity")}
      <select value={choice.id} onChange={(e) => choice.set(e.target.value)} disabled={!choice.ready}
        className="h-10 min-w-44 rounded-xl border border-border bg-background px-3 text-sm text-foreground">
        {optional ? <option value="">{t("noCommodity")}</option> : null}
        {[...choice.list].sort((a, b) => pick(a.name, locale).localeCompare(pick(b.name, locale), locale)).map((c) => <option key={c.id} value={c.id}>{pick(c.name, locale)}</option>)}
      </select>
    </label>
  );
}
