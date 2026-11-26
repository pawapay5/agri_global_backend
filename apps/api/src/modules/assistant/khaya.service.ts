import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { APP_CONFIG, AppConfig } from "../../config/config";
import { AppError } from "../../common/http/problem";
import { Cache } from "../../common/redis/redis.module";


export const LANGUAGES = [
  { code: "twi", name: "Twi", voice: true },
  { code: "fat", name: "Fante", voice: true },
  { code: "ewe", name: "Ewe", voice: true },
  { code: "gaa", name: "Ga", voice: true },
  { code: "dag", name: "Dagbani", voice: true },
] as const;
export type LocalLanguage = (typeof LANGUAGES)[number]["code"];
export type AnyLanguage = LocalLanguage | "eng";
export const isLocal = (l: string): l is LocalLanguage => LANGUAGES.some((x) => x.code === l);
export const isLanguage = (l: string): l is AnyLanguage => l === "eng" || isLocal(l);

/** Khaya accepts at most 1,000 characters per translation request (their documented limit). */
export const MAX_CHUNK = 1000;

/** Splits text into ≤ max-character chunks on sentence, then word, boundaries (exported for tests). */
export function chunkText(text: string, max = MAX_CHUNK): string[] {
  const t = text.trim();
  if (t.length <= max) return t ? [t] : [];
  const sentences = t.match(/[^.!?\n]+[.!?]*\s*|\n+/g) ?? [t];
  const out: string[] = [];
  let cur = "";
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ""; };
  for (const s of sentences) {
    if ((cur + s).length <= max) { cur += s; continue; }
    push();
    if (s.length <= max) { cur = s; continue; }
    for (const w of s.split(/(\s+)/)) {
      if ((cur + w).length > max) push();
      cur += w.length > max ? w.slice(0, max) : w;
    }
  }
  push();
  return out;
}

const PATHS = { translate: "/translate/v1/translate", asr: "/asr/v1/transcribe", tts: "/tts/v1/synthesize" };

@Injectable()
export class KhayaService {
  private readonly log = new Logger(KhayaService.name);
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig, private readonly cache: Cache) {}

  get enabled() { return Boolean(this.cfg.assistant.khayaApiKey); }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const key = this.cfg.assistant.khayaApiKey;
    if (!key) throw new AppError(503, "translation_unavailable", "Service unavailable", "Local-language support isn't configured");
    // Khaya is moving from Azure APIM keys to bearer tokens; KHAYA_AUTH=apim keeps the old scheme working.
    const auth: Record<string, string> = this.cfg.assistant.khayaAuth === "apim" ? { "Ocp-Apim-Subscription-Key": key } : { Authorization: `Bearer ${key}` };
    return { "Cache-Control": "no-cache", ...auth, ...extra };
  }

  private async call(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.assistant.khayaBaseUrl}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      this.log.warn({ err: (e as Error).message, path }, "khaya unreachable");
      throw new AppError(503, "translation_unavailable", "Service unavailable", "The language service didn't respond. Try again in a moment.");
    }
    if (res.ok) return res;
    const body = (await res.text().catch(() => "")).slice(0, 300);
    this.log.warn({ status: res.status, path, body }, "khaya error");
    if (res.status === 402) throw new AppError(503, "translation_credits", "Service unavailable", "The language service has run out of credits");
    if (res.status === 401 || res.status === 403) throw new AppError(503, "translation_unavailable", "Service unavailable", "The language service rejected our key");
    if (res.status === 413) throw AppError.unprocessable("audio_too_large", "That recording is too long");
    if (res.status === 429) throw new AppError(503, "translation_busy", "Service unavailable", "The language service is busy. Try again in a moment.");
    if (res.status === 400) throw AppError.unprocessable("translation_rejected", "The language service couldn't process that");
    throw new AppError(502, "translation_failed", "Bad gateway", "The language service failed");
  }

  /** Translation, cached for 30 days by content hash (identical advice is translated once). */
  async translate(text: string, from: AnyLanguage, to: AnyLanguage): Promise<string> {
    if (from === to || !text.trim()) return text;
    const parts = chunkText(text);
    const out: string[] = [];
    for (const part of parts) {
      const key = `khaya:tr:${from}-${to}:${createHash("sha256").update(part).digest("hex")}`;
      out.push(await this.cache.wrap(key, 30 * 86_400, async () => {
        const res = await this.call(PATHS.translate, {
          method: "POST", headers: this.headers({ "Content-Type": "application/json" }), body: JSON.stringify({ in: part, lang: `${from}-${to}` }),
        }, 30_000);
        const body = (await res.json().catch(() => null)) as unknown;
        // The API returns either a bare string or { text }.
        const t = typeof body === "string" ? body : body && typeof body === "object" && typeof (body as { text?: unknown }).text === "string" ? (body as { text: string }).text : null;
        if (t === null) throw new AppError(502, "translation_failed", "Bad gateway", "Unexpected reply from the language service");
        return t;
      }));
    }
    return out.join(" ");
  }

  /** Speech-to-text: raw audio bytes, language as a query parameter. */
  async transcribe(audio: Buffer, mime: string, language: LocalLanguage): Promise<string> {
    const type = /^(audio|video)\//.test(mime) ? mime : "application/octet-stream";
    const res = await this.call(`${PATHS.asr}?language=${encodeURIComponent(language)}`, {
      method: "POST", headers: this.headers({ "Content-Type": type }), body: new Uint8Array(audio),
    }, 60_000);
    const body = (await res.json().catch(() => null)) as unknown;
    const t = typeof body === "string" ? body : body && typeof body === "object" && typeof (body as { text?: unknown }).text === "string" ? (body as { text: string }).text : null;
    if (t === null) throw new AppError(502, "transcription_failed", "Bad gateway", "Unexpected reply from the speech service");
    return t.trim();
  }

  /** Text-to-speech: returns WAV (or another audio type) bytes. */
  async synthesize(text: string, language: LocalLanguage): Promise<{ audio: Buffer; contentType: string }> {
    const res = await this.call(PATHS.tts, {
      method: "POST", headers: this.headers({ "Content-Type": "application/json" }), body: JSON.stringify({ text: text.slice(0, 2000), language }),
    }, 60_000);
    const contentType = res.headers.get("content-type") ?? "";
    const audio = Buffer.from(await res.arrayBuffer());
    // Guard against an HTML error page served with 200.
    if (!contentType.startsWith("audio/") && audio.subarray(0, 4).toString("latin1") !== "RIFF") {
      throw new AppError(502, "speech_failed", "Bad gateway", "Unexpected reply from the speech service");
    }
    return { audio, contentType: contentType.startsWith("audio/") ? contentType : "audio/wav" };
  }
}
