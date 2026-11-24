import type { Metadata, Viewport } from "next";
import { hasLocale } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { dir, routing } from "@/i18n/routing";
import { Providers } from "@/components/providers";
import "../globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "AgriPrice: Data. Forecasts. Better Decisions.", template: "%s · AgriPrice" },
  description: "Real-time crop prices, AI price forecasts and market insights for farmers, traders and policymakers.",
  applicationName: "AgriPrice",
  openGraph: { siteName: "AgriPrice", type: "website" },
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#0F5132" }, { media: "(prefers-color-scheme: dark)", color: "#08110D" }],
};

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const messages = await getMessages({ locale });
  return (
    <html lang={locale} dir={dir(locale)} className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col font-sans">
        <Providers locale={locale} messages={messages}>{children}</Providers>
      </body>
    </html>
  );
}
