"use client";
import { CalendarRange, ChevronRight, CloudSun, LayoutGrid, Lightbulb, Ship, Sprout } from "lucide-react";
import { useTranslations } from "next-intl";
import { parseAsString, useQueryState } from "nuqs";
import { Card } from "@/components/ui/primitives";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { PageTitle } from "./common";

export const INSIGHT_VIEWS = [
  { href: "/app/insights/seasonal", key: "seasonal", icon: CalendarRange },
  { href: "/app/insights/recommendations", key: "recommendations", icon: Lightbulb },
  { href: "/app/insights/weather", key: "weather", icon: CloudSun },
  { href: "/app/insights/planting", key: "planting", icon: Sprout },
  { href: "/app/insights/export", key: "export", icon: Ship },
] as const;

/** Sub-navigation for /app/insights/*; carries the chosen commodity across views. */
export function InsightsNav() {
  const t = useTranslations("ins");
  const path = usePathname();
  const [commodity] = useQueryState("commodity", parseAsString);
  const items = [{ href: "/app/insights", key: "hub", icon: LayoutGrid } as const, ...INSIGHT_VIEWS];
  return (
    <nav aria-label={t("sections")} className="-mx-1 mb-6 overflow-x-auto px-1">
      <ul className="inline-flex gap-1 rounded-xl bg-muted p-1">
        {items.map(({ href, key, icon: Icon }) => {
          const on = path === href;
          const keep = commodity && key !== "hub" && key !== "weather" && key !== "planting";
          return (
            <li key={key}>
              <Link href={keep ? `${href}?commodity=${commodity}` : href} aria-current={on ? "page" : undefined}
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

/** /app/insights (mockup: Insights hub): one card per view, saying what each answers. */
export function InsightsHub() {
  const t = useTranslations("ins");
  return (
    <div>
      <PageTitle title={t("title")} subtitle={t("hubIntro")} />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {INSIGHT_VIEWS.map(({ href, key, icon: Icon }) => (
          <li key={key}>
            <Link href={href} className="block h-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className="flex h-full items-start gap-3 transition-shadow hover:shadow-md">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-info text-brand"><Icon aria-hidden className="size-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{t(key)}</span>
                  <span className="mt-0.5 block text-sm text-muted-fg">{t(`${key}Body`)}</span>
                </span>
                <ChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-muted-fg rtl:rotate-180" />
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
