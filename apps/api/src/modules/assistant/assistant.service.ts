import Anthropic from "@anthropic-ai/sdk";
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import type Redis from "ioredis";
import type { AuthUser } from "../../common/auth/auth.common";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { REDIS } from "../../common/redis/redis.module";
import { StorageService } from "../../common/storage/storage.service";
import { APP_CONFIG, AppConfig } from "../../config/config";
import { CatalogueService } from "../catalogue/catalogue.service";
import { ForecastsService } from "../forecasts/forecasts.service";
import { InsightsService } from "../insights/insights.service";
import { PricesService } from "../prices/prices.service";
import { type Fact, runTool, TOOLS } from "./assistant.tools";
import { type AnyLanguage, isLanguage, isLocal, KhayaService, LANGUAGES } from "./khaya.service";

export const MAX_QUESTION_CHARS = 500;
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_TOOL_ROUNDS = 6;
const HISTORY_TURNS = 6;
const RETENTION_DAYS = 90;
/** Translation-only requests are cheaper than questions, so they get a larger allowance. */
const TRANSLATE_WEIGHT = 5;

export const SYSTEM_PROMPT = `You are AgriPrice's farm assistant for smallholder farmers and traders in Ghana. Farmers ask about crop prices, price forecasts, weather and what to plant. Your answer is machine-translated into Twi, Fante, Ewe, Ga or Dagbani, and may be read aloud.

How to answer:
- Use the tools for every price, forecast, weather or planting fact. Look up crops, markets and regions with find_crop_or_place first; local crop names are fine to search.
- Only state numbers that a tool returned, with their market or place, unit, currency and date. Never estimate, round into a new figure, or fill a gap from general knowledge. If a tool has no data, or a price is marked stale, say so plainly and suggest checking the market.
- A forecast is an estimate: give the low to high range and the likely price, and the month it is for. If a forecast is withheld, explain the reason in simple words (for example: "the newest price we have is too old to forecast from").
- Write for translation and for listening: short sentences, everyday words, no idioms, no markdown, no lists or symbols, at most about 80 words. Write amounts like "GHS 12.50 per kg".
- If the question isn't clear (which crop? which market or town?), ask one short question back.
- Stay on farming, crop prices, markets, weather and planting in Ghana. Politely say you can't help with anything else. Don't give medical, legal or loan advice, and never promise that a price will happen.`;

export interface AskInput { language: string; text?: string; conversationId?: string }

/** Numbers in the English answer that the translation dropped or changed (exported for tests). */
export function missingNumbers(english: string, translated: string): string[] {
  const norm = (s: string) => (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,(?=\d{3}\b)/g, ""));
  const have = new Set(norm(translated));
  return [...new Set(norm(english))].filter((n) => !have.has(n));
}

/** The final text of a response, ignoring thinking and tool blocks (exported for tests). */
export function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
}

interface MessageRow {
  id: string; conversation_id: string; language: string; input_mode: string; question: string; question_en: string; answer: string; answer_en: string;
  facts: Fact[]; numbers_preserved: boolean; audio_key: string | null; created_at: Date;
}

@Injectable()
export class AssistantService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(AssistantService.name);
  private client?: Anthropic;
  private purgeTimer?: NodeJS.Timeout;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig, private readonly sql: Sql, @Inject(REDIS) private readonly redis: Redis,
    private readonly khaya: KhayaService, private readonly storage: StorageService, private readonly catalogue: CatalogueService,
    private readonly prices: PricesService, private readonly forecasts: ForecastsService, private readonly insights: InsightsService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.RUN_SCHEDULERS !== "true") return;
    this.purgeTimer = setInterval(() => void this.purge().catch((e) => this.log.warn({ err: (e as Error).message }, "assistant purge failed")), 6 * 3_600_000);
    this.purgeTimer.unref();
  }
  onModuleDestroy() { if (this.purgeTimer) clearInterval(this.purgeTimer); }

  async purge() {
    const old = await this.sql.many<{ audio_key: string | null }>(
      `DELETE FROM assistant_messages WHERE created_at < now() - make_interval(days => $1) RETURNING audio_key`, [RETENTION_DAYS]);
    await Promise.all(old.filter((r) => r.audio_key).map((r) => this.storage.remove(this.storage.cfg.s3.reportsBucket, r.audio_key!).catch(() => undefined)));
    await this.sql.exec(`DELETE FROM assistant_conversations c WHERE NOT EXISTS (SELECT 1 FROM assistant_messages m WHERE m.conversation_id = c.id) AND c.created_at < now() - interval '1 day'`);
  }

  private get anthropic() {
    const apiKey = this.cfg.assistant.anthropicApiKey;
    if (!apiKey) throw new AppError(503, "assistant_unavailable", "Service unavailable", "The assistant isn't configured");
    this.client ??= new Anthropic({ apiKey, timeout: 90_000, maxRetries: 2 });
    return this.client;
  }

  // ── quota ──
  private quotaKey(userId: string) { return `asst:q:${userId}:${new Date().toISOString().slice(0, 10)}`; }
  private async used(userId: string) { return Number((await this.redis.get(this.quotaKey(userId))) ?? 0); }
  private async spend(userId: string, units: number) {
    const limit = this.cfg.assistant.dailyLimitPerUser * TRANSLATE_WEIGHT; // stored in translate-units: one question = TRANSLATE_WEIGHT
    const key = this.quotaKey(userId);
    const n = await this.redis.incrby(key, units);
    if (n === units) await this.redis.expire(key, 2 * 86_400);
    if (n > limit) {
      await this.redis.decrby(key, units);
      throw new AppError(429, "assistant_limit", "Too many requests", `You've reached today's limit of ${this.cfg.assistant.dailyLimitPerUser} questions. It resets at midnight (UTC).`);
    }
    return () => this.redis.decrby(key, units).then(() => undefined, () => undefined);
  }

  async status(user: AuthUser) {
    const used = await this.used(user.id);
    return {
      enabled: Boolean(this.cfg.assistant.anthropicApiKey),
      languages: [{ code: "eng", name: "English", voice: false }, ...(this.khaya.enabled ? LANGUAGES : [])],
      translation: this.khaya.enabled,
      dailyLimit: this.cfg.assistant.dailyLimitPerUser,
      usedToday: Math.min(this.cfg.assistant.dailyLimitPerUser, Math.ceil(used / TRANSLATE_WEIGHT)),
      retentionDays: RETENTION_DAYS,
    };
  }

  private language(l: string): AnyLanguage {
    if (!isLanguage(l)) throw AppError.unprocessable("language_unsupported", "Choose Twi, Fante, Ewe, Ga, Dagbani or English");
    if (isLocal(l) && !this.khaya.enabled) throw new AppError(503, "translation_unavailable", "Service unavailable", "Local-language support isn't configured");
    return l;
  }

  /** Translate between English and a Ghanaian language (or between two Ghanaian languages, through English). */
  async translate(user: AuthUser, d: { text: string; from: string; to: string }) {
    const from = this.language(d.from), to = this.language(d.to);
    const text = d.text.trim().slice(0, 2000);
    if (!text) throw AppError.unprocessable("text_required", "Enter something to translate");
    const refund = await this.spend(user.id, 1);
    try {
      const out = from === "eng" || to === "eng" ? await this.khaya.translate(text, from, to) : await this.khaya.translate(await this.khaya.translate(text, from, "eng"), "eng", to);
      return { text: out, from, to, viaEnglish: from !== "eng" && to !== "eng" };
    } catch (e) { await refund(); throw e; }
  }

  async ask(user: AuthUser, d: AskInput, audio?: Express.Multer.File) {
    const language = this.language(d.language);
    if (audio && !isLocal(language)) throw AppError.unprocessable("voice_language", "Voice questions work in Twi, Fante, Ewe, Ga and Dagbani");
    if (audio && audio.size > MAX_AUDIO_BYTES) throw AppError.unprocessable("audio_too_large", "Keep recordings under a minute");
    if (!audio && !d.text?.trim()) throw AppError.unprocessable("text_required", "Type or record a question");
    const conv = d.conversationId
      ? await this.sql.one<{ id: string; language: string }>(`SELECT id, language FROM assistant_conversations WHERE id = $1 AND user_id = $2`, [d.conversationId, user.id])
      : null;
    if (d.conversationId && !conv) throw AppError.notFound("conversation");
    this.anthropic; // fail fast before spending quota when the assistant isn't configured

    const refund = await this.spend(user.id, TRANSLATE_WEIGHT);
    try {
      const question = (audio ? await this.khaya.transcribe(audio.buffer, audio.mimetype, language as Exclude<AnyLanguage, "eng">) : d.text!.trim()).slice(0, MAX_QUESTION_CHARS);
      if (!question) throw AppError.unprocessable("speech_empty", "We couldn't hear a question. Try again closer to the phone.");
      const questionEn = await this.khaya.translate(question, language, "eng");

      const history = conv ? await this.sql.many<{ question_en: string; answer_en: string }>(
        `SELECT question_en, answer_en FROM (SELECT question_en, answer_en, created_at FROM assistant_messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2) t ORDER BY created_at`,
        [conv.id, HISTORY_TURNS]) : [];
      const profile = await this.profile(user);
      const facts: Fact[] = [];
      const { answerEn, usage } = await this.answer(user, profile.regionId, profile.context, history, questionEn, facts);

      const answer = await this.khaya.translate(answerEn, "eng", language);
      const preserved = language === "eng" || missingNumbers(answerEn, answer).length === 0;
      const convId = conv?.id ?? (await this.sql.one<{ id: string }>(
        `INSERT INTO assistant_conversations (user_id, language) VALUES ($1, $2) RETURNING id`, [user.id, language]))!.id;
      const row = await this.sql.one<MessageRow>(
        `INSERT INTO assistant_messages (conversation_id, user_id, language, input_mode, question, question_en, answer, answer_en, facts, numbers_preserved, model, input_tokens, output_tokens)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [convId, user.id, language, audio ? "voice" : "text", question, questionEn, answer, answerEn, JSON.stringify(dedupe(facts)), preserved, this.cfg.assistant.model, usage.input, usage.output]);
      await this.sql.exec(`UPDATE assistant_conversations SET updated_at = now(), language = $2 WHERE id = $1`, [convId, language]);
      return this.dto(row!);
    } catch (e) { await refund(); throw e; }
  }

  private async profile(user: AuthUser) {
    const p = await this.sql.one<{ region_id: string | null; region: unknown; crops: unknown[] | null; role: string }>(
      `SELECT fp.region_id, r.name AS region, u.role,
              (SELECT array_agg(c.name) FROM commodities c WHERE c.id = ANY(fp.crop_ids)) AS crops
       FROM users u LEFT JOIN farming_profiles fp ON fp.user_id = u.id LEFT JOIN regions r ON r.id = fp.region_id WHERE u.id = $1`, [user.id]);
    const name = (n: unknown) => (n && typeof n === "object" ? (n as Record<string, string>).en ?? Object.values(n as Record<string, string>)[0] : String(n ?? ""));
    const crops = (p?.crops ?? []).map(name).filter(Boolean);
    const context = [
      `Today is ${new Date().toISOString().slice(0, 10)}. Country: Ghana (${user.country}).`,
      `The person asking is a ${p?.role ?? "farmer"}.`,
      p?.region_id ? `Their region: ${name(p.region)} (region_id ${p.region_id}).` : "Their region isn't on their profile.",
      crops.length ? `Crops they grow or follow: ${crops.join(", ")}.` : "",
    ].filter(Boolean).join(" ");
    return { regionId: p?.region_id ?? null, context };
  }

  /** Claude with AgriPrice tools. Manual loop so each tool call runs under the farmer's own permissions. */
  private async answer(user: AuthUser, regionId: string | null, context: string, history: { question_en: string; answer_en: string }[], questionEn: string, facts: Fact[]) {
    const messages: Anthropic.Beta.BetaMessageParam[] = [];
    for (const h of history) messages.push({ role: "user", content: h.question_en }, { role: "assistant", content: h.answer_en });
    messages.push({ role: "user", content: `<farmer_context>${context}</farmer_context>\n\n${questionEn}` });
    const usage = { input: 0, output: 0 };
    const deps = { sql: this.sql, catalogue: this.catalogue, prices: this.prices, forecasts: this.forecasts, insights: this.insights };

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let res: Anthropic.Beta.BetaMessage;
      try {
        res = await this.anthropic.beta.messages.create({
          model: this.cfg.assistant.model,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default", // if a safety classifier declines, the API retries on a suitable model in the same call
          output_config: { effort: "low" }, // short chat answers; raise only if quality measurably improves
          system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }], // tools + system prompt are cached
          tools: TOOLS,
          messages,
          metadata: { user_id: user.id },
        });
      } catch (e) {
        throw mapClaudeError(e, this.log);
      }
      usage.input += res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
      usage.output += res.usage.output_tokens;

      if (res.stop_reason === "refusal") return { answerEn: "Sorry, I can't help with that. Ask me about crop prices, forecasts, weather or planting.", usage };
      if (res.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: res.content }); continue; }
      const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || !calls.length) {
        const text = textOf(res.content);
        return { answerEn: text || "Sorry, I couldn't put an answer together. Please ask again.", usage };
      }
      messages.push({ role: "assistant", content: res.content });
      // Parallel tool calls: run together, return every result in one user message.
      const results = await Promise.all(calls.map(async (c) => {
        const r = await runTool(c.name, (c.input ?? {}) as Record<string, unknown>, deps, { user, regionId, facts });
        return { type: "tool_result" as const, tool_use_id: c.id, content: r.content, ...(r.isError ? { is_error: true } : {}) };
      }));
      messages.push({ role: "user", content: results });
    }
    return { answerEn: "Sorry, that took too many steps. Please ask a shorter question, for example about one crop and one market.", usage };
  }

  async history(user: AuthUser, conversationId?: string) {
    const conv = conversationId
      ? await this.sql.one<{ id: string }>(`SELECT id FROM assistant_conversations WHERE id = $1 AND user_id = $2`, [conversationId, user.id])
      : await this.sql.one<{ id: string }>(`SELECT id FROM assistant_conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`, [user.id]);
    if (!conv) return { conversationId: null, data: [] };
    const rows = await this.sql.many<MessageRow>(`SELECT * FROM assistant_messages WHERE conversation_id = $1 ORDER BY created_at LIMIT 50`, [conv.id]);
    return { conversationId: conv.id, data: rows.map((r) => this.dto(r)) };
  }

  async clear(user: AuthUser) {
    const rows = await this.sql.many<{ audio_key: string | null }>(`DELETE FROM assistant_messages WHERE user_id = $1 RETURNING audio_key`, [user.id]);
    await this.sql.exec(`DELETE FROM assistant_conversations WHERE user_id = $1`, [user.id]);
    await Promise.all(rows.filter((r) => r.audio_key).map((r) => this.storage.remove(this.storage.cfg.s3.reportsBucket, r.audio_key!).catch(() => undefined)));
  }

  /** Spoken answer, generated on first play and kept (privately) for the message's lifetime. */
  async audio(user: AuthUser, id: string): Promise<{ audio: Buffer; contentType: string }> {
    const m = await this.sql.one<MessageRow>(`SELECT * FROM assistant_messages WHERE id = $1 AND user_id = $2`, [id, user.id]);
    if (!m) throw AppError.notFound("message");
    if (!isLocal(m.language)) throw AppError.unprocessable("voice_language", "Spoken answers are available in Twi, Fante, Ewe, Ga and Dagbani");
    const bucket = this.storage.cfg.s3.reportsBucket;
    if (m.audio_key) {
      const audio = await this.storage.get(bucket, m.audio_key).catch(() => null);
      if (audio) return { audio, contentType: "audio/wav" };
    }
    const out = await this.khaya.synthesize(m.answer, m.language);
    const key = `assistant/${user.id}/${m.id}.wav`;
    await this.storage.put(bucket, key, out.audio, out.contentType);
    await this.sql.exec(`UPDATE assistant_messages SET audio_key = $2 WHERE id = $1`, [m.id, key]);
    return out;
  }

  private dto(r: MessageRow) {
    return {
      id: r.id, conversationId: r.conversation_id, language: r.language, inputMode: r.input_mode,
      question: r.question, questionEnglish: r.question_en, answer: r.answer, answerEnglish: r.answer_en,
      translated: r.language !== "eng", numbersPreserved: r.numbers_preserved, facts: r.facts ?? [],
      hasVoice: isLocal(r.language), createdAt: r.created_at.toISOString(),
    };
  }
}

function dedupe(facts: Fact[]): Fact[] {
  const seen = new Set<string>();
  return facts.filter((f) => { const k = JSON.stringify(f); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);
}

function mapClaudeError(e: unknown, log: Logger): AppError {
  if (e instanceof Anthropic.RateLimitError) return new AppError(503, "assistant_busy", "Service unavailable", "The assistant is busy. Try again in a minute.");
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    log.error("Anthropic rejected the API key");
    return new AppError(503, "assistant_unavailable", "Service unavailable", "The assistant isn't available right now");
  }
  if (e instanceof Anthropic.BadRequestError) { log.error({ err: e.message }, "assistant request rejected"); return new AppError(502, "assistant_failed", "Bad gateway", "The assistant couldn't answer that"); }
  if (e instanceof Anthropic.APIError) { log.warn({ status: e.status, err: e.message }, "assistant API error"); return new AppError(503, "assistant_busy", "Service unavailable", "The assistant is having trouble. Try again shortly."); }
  if (e instanceof Anthropic.APIConnectionError) return new AppError(503, "assistant_busy", "Service unavailable", "The assistant couldn't be reached. Try again shortly.");
  return e instanceof AppError ? e : new AppError(502, "assistant_failed", "Bad gateway", "The assistant failed");
}
