import { ImageResponse } from "next/og";
import { codeOf, findCommodity, getHistory } from "@/lib/api/public";
import { packCommodity, packCountry } from "@/lib/countries";
import { formatMoney, pick } from "@/lib/utils";

export const alt = "AgriPrice crop price";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social card: commodity, latest national average, weekly change and a 6-month sparkline. */
export default async function OgImage({ params }: { params: Promise<{ locale: string; country: string; commodity: string }> }) {
  const { locale, country, commodity } = await params;
  const c = packCountry(country), pc = packCommodity(codeOf(commodity));
  const name = pick(pc?.name, locale) || commodity;
  const found = c ? await findCommodity(c.iso2, commodity, locale) : null;
  const h = found && c ? await getHistory(found.id, c.iso2, "6M") : null;
  const vals = (h?.points ?? []).map((p) => Number(p.avg)).filter(Number.isFinite);
  const change = h?.stats.changePctWoW ?? null;
  const W = 1040, H = 160;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const path = vals.length > 1 ? vals.map((v, i) => `${i ? "L" : "M"}${((i / (vals.length - 1)) * W).toFixed(1)},${(H - ((v - min) / span) * (H - 10) - 5).toFixed(1)}`).join(" ") : "";
  const up = (change ?? 0) >= 0;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: 64, background: "#F7F9F8", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, color: "#0F5132", fontSize: 36, fontWeight: 700 }}>
          <div style={{ width: 48, height: 48, borderRadius: 24, background: "#3BB54A" }} />
          {c?.brand ?? "AgriPrice"}
        </div>
        <div style={{ marginTop: 40, fontSize: 64, fontWeight: 800, color: "#13241B" }}>{name} · {pick(c?.name, locale)}</div>
        <div style={{ marginTop: 16, display: "flex", alignItems: "baseline", gap: 24 }}>
          <div style={{ fontSize: 72, fontWeight: 800, color: "#0F5132" }}>{h?.stats.latest ? `${formatMoney(h.stats.latest, h.currency, locale)}/${h.unit}` : "Live prices"}</div>
          {change != null ? <div style={{ fontSize: 44, fontWeight: 700, color: up ? "#16A34A" : "#DC2626" }}>{`${up ? "▲" : "▼"} ${Math.abs(change).toFixed(1)}%`}</div> : null}
        </div>
        {path ? (
          <svg width={W} height={H} style={{ marginTop: 32 }}><path d={path} fill="none" stroke={up ? "#16A34A" : "#DC2626"} strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" /></svg>
        ) : null}
        <div style={{ marginTop: "auto", fontSize: 28, color: "#5B6B62" }}>Data. Forecasts. Better Decisions.</div>
      </div>
    ),
    size,
  );
}
