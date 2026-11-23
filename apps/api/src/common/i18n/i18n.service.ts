import { Global, Injectable, Module } from "@nestjs/common";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

type Catalog = Record<string, string>;
/**
 * Locale catalogues. A country pack can ship further locales (e.g. tw, ee, ha). Those are
 * loaded at seed time into notification_templates. UI strings stay in the client apps.
 */
const CATALOGS: Record<string, Catalog> = { en, fr };

export type LocalizedText = Record<string, string>;

@Injectable()
export class I18nService {
  /** Fallback chain: exact (fr-CI) → language (fr) → en. */
  private chain(locale: string): string[] {
    const lang = locale.split("-")[0]!.toLowerCase();
    return [...new Set([locale, lang, "en"])];
  }

  t(key: string, locale: string, params: Record<string, string | number> = {}): string {
    for (const l of this.chain(locale)) {
      const msg = CATALOGS[l]?.[key];
      if (msg) return msg.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(params[k] ?? ""));
    }
    return key;
  }

  has(key: string, locale = "en"): boolean {
    return this.chain(locale).some((l) => CATALOGS[l]?.[key] != null);
  }

  /** Pick the best string from a {locale: text} map. */
  pick(text: LocalizedText | null | undefined, locale: string): string {
    if (!text) return "";
    for (const l of this.chain(locale)) if (text[l]) return text[l];
    return Object.values(text)[0] ?? "";
  }

  monthName(m: number, locale: string) { return this.t(`month.${m}`, locale); }

  joinList(items: string[], locale: string): string {
    if (items.length <= 1) return items.join("");
    return `${items.slice(0, -1).join(", ")} ${this.t("list.and", locale)} ${items[items.length - 1]}`;
  }
}

@Global()
@Module({ providers: [I18nService], exports: [I18nService] })
export class I18nModule {}
