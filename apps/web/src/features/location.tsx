"use client";
import { Crosshair, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsFloat, parseAsString, useQueryStates } from "nuqs";
import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { useRegions } from "@/lib/api/queries";
import { pick } from "@/lib/utils";

/** Two decimals ≈ 1.1 km: enough for nearby markets and weather, too coarse to pinpoint a home. Exported for tests. */
export const coarse = (v: number) => Math.round(v * 100) / 100;

/**
 * The search origin, kept in the URL (?lat=&lng=, plus ?region= when it came from a region) so a view can be
 * shared and survives reloads. Nothing is stored server-side.
 */
export function useOrigin(cc: string) {
  const locale = useLocale();
  const t = useTranslations("mkt");
  const regions = useRegions(cc);
  const [q, setQ] = useQueryStates({ lat: parseAsFloat, lng: parseAsFloat, region: parseAsString });
  const region = regions.data?.find((r) => r.id === q.region);
  const has = q.lat != null && q.lng != null;
  return {
    lat: q.lat, lng: q.lng, regionId: q.region, has,
    label: has ? (region ? pick(region.name, locale) : t("yourLocation")) : null,
    regions: (regions.data ?? []).filter((r) => r.centroid).sort((a, b) => pick(a.name, locale).localeCompare(pick(b.name, locale), locale)),
    setPoint: (lat: number, lng: number, regionId: string | null = null) => void setQ({ lat: coarse(lat), lng: coarse(lng), region: regionId }),
  };
}

type LocError = "denied" | "unavailable" | "unsupported" | null;

/** "Use my location" (rounded) or "start from a region", with the privacy note and errors spelled out. */
export function LocationPicker({ origin, idPrefix = "loc" }: { origin: ReturnType<typeof useOrigin>; idPrefix?: string }) {
  const t = useTranslations("mkt");
  const locale = useLocale();
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState<LocError>(null);
  const locate = () => {
    if (!("geolocation" in navigator)) return setErr("unsupported");
    setLocating(true); setErr(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLocating(false); origin.setPoint(pos.coords.latitude, pos.coords.longitude); },
      (e) => { setLocating(false); setErr(e.code === e.PERMISSION_DENIED ? "denied" : "unavailable"); },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
  };
  const fromRegion = (id: string) => {
    const r = origin.regions.find((x) => x.id === id);
    if (r?.centroid) origin.setPoint(r.centroid.lat, r.centroid.lng, id);
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <Button type="button" onClick={locate} disabled={locating} aria-describedby={`${idPrefix}-privacy`}>
          {locating ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Crosshair aria-hidden className="size-4" />}
          {locating ? t("locating") : t("useLocation")}
        </Button>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-fg">
          {t("orRegion")}
          <select value={origin.regionId ?? ""} onChange={(e) => e.target.value && fromRegion(e.target.value)} disabled={!origin.regions.length}
            className="h-10 min-w-44 rounded-xl border border-border bg-background px-3 text-sm text-foreground">
            <option value="">{t("chooseRegion")}</option>
            {origin.regions.map((r) => <option key={r.id} value={r.id}>{pick(r.name, locale)}</option>)}
          </select>
        </label>
      </div>
      <p id={`${idPrefix}-privacy`} className="text-xs text-muted-fg">{t("locPrivacy")}</p>
      {err ? <p role="alert" className="text-sm text-down">{t(err === "denied" ? "locDenied" : err === "unsupported" ? "locUnsupported" : "locUnavailable")}</p> : null}
    </div>
  );
}
