import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";

export const alt = "AgriPrice: crop prices and forecasts";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Default social card for public pages without their own (commodity pages render a price-specific one). */
export default async function OgImage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing" });
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#0F5132", color: "#FFFFFF", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 40, fontWeight: 700 }}>
          <div style={{ width: 52, height: 52, borderRadius: 26, background: "#3BB54A" }} />
          AgriPrice
        </div>
        <div style={{ display: "flex", fontSize: 66, fontWeight: 800, lineHeight: 1.1, maxWidth: 980 }}>{t("heroTitle", { country: "Ghana" })}</div>
        <div style={{ display: "flex", fontSize: 30, color: "#CFE9D5" }}>Data. Forecasts. Better Decisions.</div>
      </div>
    ),
    size,
  );
}
