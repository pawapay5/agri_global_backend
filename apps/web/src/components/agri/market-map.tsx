"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapPin } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import Map, { Marker, NavigationControl, Popup } from "react-map-gl/maplibre";
import { money, number, unitLabel } from "@/lib/format";
import { cn, pick } from "@/lib/utils";

/** Free OpenFreeMap vector style (no API key, no cost); allowed in the CSP connect-src. */
export const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export interface MapMarket {
  id: string;
  name: Record<string, string>;
  location: { lat: number; lng: number };
  distanceKm?: number;
  price?: { amount: string; currency: string; unit: string } | null;
}

/**
 * Market map (MapLibre via react-map-gl). Keyboard: the map canvas pans with arrow keys and zooms with +/-;
 * every marker is a real button. The list below is the accessible equivalent and is always rendered.
 * Heavy (MapLibre ~200 KB gz): import it with next/dynamic({ ssr: false }) on the routes that need it.
 */
export function MarketMap({ markets, onSelect, selectedId, height = 420, className }: {
  markets: MapMarket[]; onSelect?: (id: string) => void; selectedId?: string | null; height?: number; className?: string;
}) {
  const t = useTranslations("ds");
  const locale = useLocale();
  const [open, setOpen] = useState<string | null>(selectedId ?? null);
  const view = useMemo(() => {
    if (!markets.length) return { latitude: 7.95, longitude: -1.03, zoom: 5.6 };
    const lats = markets.map((m) => m.location.lat), lngs = markets.map((m) => m.location.lng);
    return { latitude: (Math.min(...lats) + Math.max(...lats)) / 2, longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2, zoom: markets.length === 1 ? 11 : 6 };
  }, [markets]);
  const current = markets.find((m) => m.id === open);
  const choose = (id: string) => { setOpen(id); onSelect?.(id); };
  const priceText = (m: MapMarket) => (m.price ? `${money(m.price.amount, m.price.currency, locale)}/${unitLabel(m.price.unit)}` : null);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="overflow-hidden rounded-xl border border-border" style={{ height }}>
        <Map initialViewState={view} mapStyle={MAP_STYLE} style={{ width: "100%", height: "100%" }} aria-label={t("mapLabel")} keyboard cooperativeGestures attributionControl={{ compact: true }}>
          <NavigationControl position="top-right" showCompass={false} />
          {markets.map((m) => (
            <Marker key={m.id} latitude={m.location.lat} longitude={m.location.lng} anchor="bottom">
              <button type="button" onClick={() => choose(m.id)} aria-label={pick(m.name, locale)} aria-pressed={open === m.id}
                className="grid size-9 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
                <MapPin aria-hidden className={cn("size-7 drop-shadow", open === m.id ? "fill-brand text-brand-fg" : "fill-card text-brand")} />
              </button>
            </Marker>
          ))}
          {current ? (
            <Popup latitude={current.location.lat} longitude={current.location.lng} anchor="top" onClose={() => setOpen(null)} closeOnClick={false}>
              <p className="font-semibold text-[#13241b]">{pick(current.name, locale)}</p>
              {priceText(current) ? <p className="tabular text-[#13241b]">{priceText(current)}</p> : null}
            </Popup>
          ) : null}
        </Map>
      </div>
      <h3 className="sr-only">{t("mapList")}</h3>
      <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
        {markets.map((m) => (
          <li key={m.id}>
            <button type="button" onClick={() => choose(m.id)} aria-pressed={open === m.id}
              className={cn("flex w-full items-center justify-between gap-3 px-4 py-2.5 text-start hover:bg-muted", open === m.id && "bg-muted")}>
              <span className="font-medium">{pick(m.name, locale)}</span>
              <span className="flex items-center gap-3 text-muted-fg">
                {priceText(m) ? <span className="tabular text-foreground">{priceText(m)}</span> : null}
                {m.distanceKm != null ? <span>{t("distance", { km: number(m.distanceKm, locale, { digits: 1 }) })}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
