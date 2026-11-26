import { describe, expect, it } from "vitest";
import { encodeWav, SAMPLE_RATE } from "@/lib/audio/wav";
import { defaultLanguage, factLine } from "./assistant";

const t = (k: string, v: Record<string, string | number> = {}) => `${k}:${Object.entries(v).map(([a, b]) => `${a}=${b}`).join("|")}`;

describe("voice recording", () => {
  it("writes a 16 kHz mono 16-bit WAV header and clamps samples", () => {
    const buf = encodeWav(new Float32Array([0, 1, -1, 2]));
    const v = new DataView(buf);
    const tag = (o: number) => String.fromCharCode(...new Uint8Array(buf, o, 4));
    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(SAMPLE_RATE);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(8);
    expect(v.getInt16(46, true)).toBe(0x7fff);
    expect(v.getInt16(50, true)).toBe(0x7fff); // 2 is clamped to 1
  });
});

describe("assistant language", () => {
  it("starts Twi, Ewe and Dagbani users in their own language, others in Twi", () => {
    expect(defaultLanguage("tw")).toBe("twi");
    expect(defaultLanguage("ee")).toBe("ewe");
    expect(defaultLanguage("dag")).toBe("dag");
    expect(defaultLanguage("en-GH")).toBe("twi");
  });
});

describe("figures", () => {
  it("writes prices and forecasts from the data, with currency and unit", () => {
    const price = factLine({ kind: "price", commodity: "Maize", market: "Techiman", amount: "4.20", currency: "GHS", unit: "kg", priceType: "wholesale", observedAt: "2026-11-20" }, "en", t);
    expect(price).toContain("crop=Maize");
    expect(price).toContain("market=Techiman");
    expect(price).toMatch(/price=GH₵\s?4\.20|price=GHS\s?4\.20/);
    expect(price).toContain("per= / kg");
    const fc = factLine({ kind: "forecast", commodity: "Maize", place: "Techiman", horizonMonths: 3, targetDate: "2027-02-20", low: "4.00", mid: "4.50", high: "5.10", currency: "GHS", unit: "kg" }, "en", t);
    expect(fc).toContain("months=3");
    expect(fc).toMatch(/low=GH₵\s?4\.00|low=GHS\s?4\.00/);
  });
});
