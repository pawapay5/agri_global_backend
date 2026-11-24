"use client";
import { Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsString, useQueryState } from "nuqs";
import { Card, Input } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { useCommodities, useMe } from "@/lib/api/queries";
import { pick } from "@/lib/utils";
import { PageTitle, QueryState } from "./common";

/** Commodity picker; `target` decides where each row links (detail page or forecast). */
export function CommodityList({ target }: { target: "detail" | "forecast" }) {
  const t = useTranslations();
  const locale = useLocale();
  const me = useMe();
  const list = useCommodities(me.data?.country ?? "");
  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  return (
    <div>
      <PageTitle title={target === "forecast" ? t("nav.forecast") : t("nav.commodities")} />
      <label className="relative mb-4 block max-w-md">
        <Search aria-hidden className="absolute start-3 top-3 size-5 text-muted-fg" />
        <Input value={q} onChange={(e) => setQ(e.target.value || null)} className="ps-10" placeholder={t("app.selectCommodity")} aria-label={t("app.selectCommodity")} />
      </label>
      <QueryState q={list}>
        {(page) => {
          const items = page.data.filter((c) => !q || pick(c.name, locale).toLowerCase().includes(q.toLowerCase()));
          return (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((c) => (
                <li key={c.id}>
                  <Link href={target === "forecast" ? `/app/forecast/${c.id}` : `/app/commodities/${c.id}`}>
                    <Card className="hover:ring-2 hover:ring-ring"><p className="font-semibold">{pick(c.name, locale)}</p><p className="text-xs capitalize text-muted-fg">{c.perishability} perishability · HS {c.hsCode ?? "—"}</p></Card>
                  </Link>
                </li>
              ))}
            </ul>
          );
        }}
      </QueryState>
    </div>
  );
}
