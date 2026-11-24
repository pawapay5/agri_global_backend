import { describe, expect, it } from "vitest";
import { fitSms, mergeKeywords, parseCommand, resolveName, splitCommodityMarket } from "./sms.logic";

describe("parseCommand", () => {
  it("parses PRICE", () => expect(parseCommand("PRICE TOMATO KUMASI")).toEqual({ cmd: "price", commodity: "TOMATO KUMASI", market: null }));
  it("parses ALERT with market and decimal comma", () => {
    expect(parseCommand("alert tomato below 16")).toEqual({ cmd: "alert", commodity: "tomato", condition: "below", threshold: "16", market: null });
    expect(parseCommand("ALERT white maize ABOVE 12,5 techiman")).toEqual({ cmd: "alert", commodity: "white maize", condition: "above", threshold: "12.5", market: "techiman" });
  });
  it("parses STOP / HELP and rejects malformed commands", () => {
    expect(parseCommand("  stop ")).toEqual({ cmd: "stop" });
    expect(parseCommand("")).toEqual({ cmd: "help" });
    expect(parseCommand("ALERT tomato below lots").cmd).toBe("unknown");
    expect(parseCommand("hello there").cmd).toBe("unknown");
  });
  it("supports country-pack keywords", () => {
    const kw = mergeKeywords({ price: ["BOƆ"] });
    expect(parseCommand("boɔ ntoosi", kw).cmd).toBe("price");
  });
});

describe("name resolution", () => {
  const commodities = [{ id: "tom", names: ["Tomato", "ntoosi"] }, { id: "maize", names: ["White maize", "aburo", "maize"] }, { id: "yam", names: ["Yam", "bayerɛ"] }];
  const markets = [{ id: "ksi", names: ["Kumasi Central Market", "Kumasi"] }, { id: "tech", names: ["Techiman"] }];
  it("matches aliases, plurals, accents and single typos", () => {
    expect(resolveName("TOMATOES", commodities)).toBe("tom");
    expect(resolveName("tomatoe", commodities)).toBe("tom");
    expect(resolveName("bayere", commodities)).toBe("yam");
    expect(resolveName("techimann", markets)).toBe("tech");
    expect(resolveName("xyz", commodities)).toBeNull();
  });
  it("splits commodity and market from one phrase", () => {
    expect(splitCommodityMarket("TOMATO KUMASI", commodities, markets)).toEqual({ commodityId: "tom", marketId: "ksi", marketText: "KUMASI" });
    expect(splitCommodityMarket("white maize techiman", commodities, markets)).toMatchObject({ commodityId: "maize", marketId: "tech" });
    expect(splitCommodityMarket("tomato", commodities, markets)).toMatchObject({ commodityId: "tom", marketId: null });
  });
  it("truncates long replies to one SMS", () => expect(fitSms("x".repeat(200))).toHaveLength(160));
});
