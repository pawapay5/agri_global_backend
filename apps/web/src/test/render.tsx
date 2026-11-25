import { render, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import en from "@/messages/en.json";

/** Render inside the same intl provider the app uses (English catalogue, UTC). */
export function renderWithIntl(ui: ReactElement, { locale = "en", ...opts }: RenderOptions & { locale?: string } = {}) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale={locale} messages={en} timeZone="UTC">{children}</NextIntlClientProvider>
  );
  return render(ui, { wrapper: Wrapper, ...opts });
}
