import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { AssistantService, missingNumbers, SYSTEM_PROMPT } from "./assistant.service";
import { runTool, TOOLS, type Fact } from "./assistant.tools";
import { chunkText, isLanguage, isLocal, MAX_CHUNK } from "./khaya.service";

const user = { id: "u1", role: "farmer", country: "GH" } as never;
const MAIZE = "11111111-1111-4111-8111-111111111111";
const MARKET = "22222222-2222-4222-8222-222222222222";

describe("text chunking for translation", () => {
  it("keeps short text whole and splits long text on sentences under the limit", () => {
    expect(chunkText("Maize is up.")).toEqual(["Maize is up."]);
    const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} about maize prices.`).join(" ");
    const parts = chunkText(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= MAX_CHUNK)).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(long);
  });
  it("hard-splits a single overlong word rather than sending more than the limit", () => {
    expect(chunkText("x".repeat(2500)).every((p) => p.length <= MAX_CHUNK)).toBe(true);
  });
});

describe("languages", () => {
  it("uses Khaya's three-letter codes", () => {
    expect(isLocal("twi") && isLocal("gaa") && isLocal("dag")).toBe(true);
    expect(isLanguage("tw")).toBe(false);
    expect(isLanguage("eng")).toBe(true);
  });
});

describe("figures survive translation", () => {
  it("finds numbers the translation dropped or changed", () => {
    expect(missingNumbers("Maize is GHS 12.50 per kg at Techiman on 2026-11-20.", "Aburow yɛ GHS 12.50 kg biara wɔ Techiman 2026-11-20.")).toEqual([]);
    expect(missingNumbers("Maize is GHS 12.50 per kg.", "Aburow yɛ GHS 1250 kg biara.")).toEqual(["12.50"]);
    expect(missingNumbers("About 1,200 bags.", "Bɛyɛ 1200 bags.")).toEqual([]);
  });
});

describe("tools", () => {
  it("every tool is strict with a closed schema", () => {
    for (const t of TOOLS) {
      expect(t.strict).toBe(true);
      expect((t.input_schema as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    }
  });

  const deps = (over: Partial<Record<string, unknown>> = {}) => ({
    sql: { one: vi.fn().mockResolvedValue({ name: { en: "Maize" } }), many: vi.fn().mockResolvedValue([]) },
    catalogue: { search: vi.fn() }, insights: { weather: vi.fn(), planting: vi.fn() },
    prices: { latest: vi.fn() }, forecasts: { get: vi.fn() }, ...over,
  }) as never;

  it("records each price as a fact and marks old prices stale", async () => {
    const old = new Date(Date.now() - 45 * 86_400_000).toISOString();
    const d = deps({ prices: { latest: vi.fn().mockResolvedValue([
      { marketName: { en: "Techiman" }, value: { display: { amount: "4.20", currency: "GHS", unit: "kg" } }, observedAt: new Date().toISOString(), changePctWoW: 3.1 },
      { marketName: { en: "Ejura" }, value: { display: { amount: "3.90", currency: "GHS", unit: "kg" } }, observedAt: old, changePctWoW: null },
    ]) } });
    const facts: Fact[] = [];
    const r = await runTool("get_latest_prices", { commodity_id: MAIZE, price_type: "wholesale", region_id: null }, d, { user, regionId: null, facts });
    const out = JSON.parse(r.content);
    expect(r.isError).toBe(false);
    expect(out.markets.map((m: { stale: boolean }) => m.stale)).toEqual([false, true]);
    expect(facts).toHaveLength(2);
    expect(facts[0]).toMatchObject({ kind: "price", market: "Techiman", amount: "4.20", currency: "GHS" });
  });

  it("explains a withheld forecast instead of returning numbers", async () => {
    const d = deps({ forecasts: { get: vi.fn().mockResolvedValue({ status: "insufficient_data", reasons: ["stale_data"], lastObservedAt: "2023-07-15", horizons: [] }) } });
    const facts: Fact[] = [];
    const out = JSON.parse((await runTool("get_price_forecast", { commodity_id: MAIZE, price_type: "wholesale", market_id: MARKET, region_id: null }, d, { user, regionId: null, facts })).content);
    expect(out).toMatchObject({ status: "withheld", reasons: ["stale_data"], lastPriceDate: "2023-07-15" });
    expect(facts).toEqual([]);
  });

  it("rejects made-up ids and asks for a region when the farmer has none", async () => {
    const r1 = await runTool("get_latest_prices", { commodity_id: "maize", price_type: "wholesale", region_id: null }, deps(), { user, regionId: null, facts: [] });
    expect(r1.isError).toBe(true);
    const r2 = await runTool("get_weather_advice", { region_id: null }, deps(), { user, regionId: null, facts: [] });
    expect(JSON.parse(r2.content).error).toMatch(/region/);
  });
});

describe("assistant", () => {
  function service(responses: unknown[]) {
    const create = vi.fn();
    for (const r of responses) create.mockResolvedValueOnce(r);
    const sql = {
      one: vi.fn(async (q: string) => q.includes("FROM users u") ? { region_id: null, region: null, role: "farmer", crops: [] }
        : q.includes("INSERT INTO assistant_conversations") ? { id: "c1" }
        : q.includes("INSERT INTO assistant_messages") ? { id: "m1", conversation_id: "c1", language: "twi", input_mode: "text", question: "q", question_en: "q", answer: "a", answer_en: "a", facts: [], numbers_preserved: true, audio_key: null, created_at: new Date() }
        : { name: { en: "Maize" } }),
      many: vi.fn().mockResolvedValue([]), exec: vi.fn(),
    };
    const redis = { get: vi.fn(), incrby: vi.fn().mockResolvedValue(5), expire: vi.fn(), decrby: vi.fn().mockResolvedValue(0) };
    const khaya = { enabled: true, translate: vi.fn(async (t: string, from: string, to: string) => `[${from}>${to}] ${t}`) };
    const catalogue = { search: vi.fn().mockResolvedValue({ commodities: [{ id: MAIZE, name: { en: "Maize" } }], markets: [] }) };
    const cfg = { assistant: { anthropicApiKey: "k", model: "claude-opus-5-5", dailyLimitPerUser: 20 } };
    const svc = new AssistantService(cfg as never, sql as never, redis as never, khaya as never, {} as never, catalogue as never, {} as never, {} as never, {} as never);
    (svc as unknown as { client: unknown }).client = { beta: { messages: { create } } };
    return { svc, create, khaya, sql, redis };
  }
  const usage = { input_tokens: 10, output_tokens: 5 };

  it("runs the tool loop, then translates the English answer back", async () => {
    const { svc, create, khaya } = service([
      { stop_reason: "tool_use", usage, content: [{ type: "tool_use", id: "t1", name: "find_crop_or_place", input: { query: "aburow" } }] },
      { stop_reason: "end_turn", usage, content: [{ type: "text", text: "Which market do you sell in?" }] },
    ]);
    await svc.ask(user, { language: "twi", text: "Aburow boɔ yɛ sɛn?" });
    expect(khaya.translate).toHaveBeenNthCalledWith(1, "Aburow boɔ yɛ sɛn?", "twi", "eng");
    expect(khaya.translate).toHaveBeenLastCalledWith("Which market do you sell in?", "eng", "twi");
    const first = create.mock.calls[0]![0];
    expect(first.model).toBe("claude-opus-5-5");
    expect(first.system[0].text).toBe(SYSTEM_PROMPT);
    expect(first.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(first.fallbacks).toBe("default");
    // The tool result goes back in one user message, tied to the call.
    const second = create.mock.calls[1]![0];
    const last = second.messages.at(-1);
    expect(last.role).toBe("user");
    expect(last.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1" });
  });

  it("gives a safe reply on refusal and refunds the quota when something fails", async () => {
    const ok = service([{ stop_reason: "refusal", usage, content: [] }]);
    await ok.svc.ask(user, { language: "eng", text: "something off-topic" });
    expect(ok.khaya.translate).toHaveBeenCalledTimes(2);
    const failing = service([]);
    (failing.svc as unknown as { client: { beta: { messages: { create: unknown } } } }).client.beta.messages.create = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(failing.svc.ask(user, { language: "eng", text: "maize price?" })).rejects.toBeTruthy();
    expect(failing.redis.decrby).toHaveBeenCalled();
  });

  it("stops at the daily limit", async () => {
    const { svc, redis } = service([]);
    redis.incrby.mockResolvedValue(20 * 5 + 5);
    await expect(svc.ask(user, { language: "eng", text: "maize?" })).rejects.toMatchObject({ code: "assistant_limit" });
  });

  it("only accepts voice in local languages", async () => {
    const { svc } = service([]);
    await expect(svc.ask(user, { language: "eng" }, { size: 10, buffer: Buffer.alloc(10), mimetype: "audio/wav" } as never)).rejects.toMatchObject({ code: "voice_language" });
  });
});
