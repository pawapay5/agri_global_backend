import { describe, expect, it } from "vitest";
import { decideStatus, median, robustZ, seriesStats, validateObservation } from "./price.logic";

const ref = [10, 10.5, 9.8, 10.2, 10.1, 9.9, 10.4, 10.0, 10.3, 9.7];

describe("robustZ (rolling MAD)", () => {
  it("returns null without enough reference data", () => expect(robustZ(10, [10, 11])).toBeNull());
  it("scores in-range prices near zero", () => expect(Math.abs(robustZ(10.1, ref)!)).toBeLessThan(1));
  it("scores a 3× jump as an extreme outlier", () => expect(robustZ(30, ref)!).toBeGreaterThan(3.5));
  it("is symmetric in log space", () => {
    expect(Math.abs(robustZ(20, ref)! + robustZ(5, ref)!)).toBeLessThan(0.5);
  });
  it("handles zero MAD (many identical prices)", () => {
    const flat = [10, 10, 10, 10, 10, 10, 10, 10, 12];
    expect(Number.isFinite(robustZ(10, flat)!)).toBe(true);
    expect(robustZ(30, flat)!).toBeGreaterThan(3.5);
  });
  it("median of even/odd arrays", () => { expect(median([1, 3, 2])).toBe(2); expect(median([1, 2, 3, 4])).toBe(2.5); });
});

describe("decideStatus", () => {
  it("flags outliers regardless of source", () => {
    expect(decideStatus("source_pull", 5, { corroborated: true }).status).toBe("flagged");
    expect(decideStatus("crowd", -4, { corroborated: true }).flags).toContain("outlier_low");
  });
  it("auto-approves trusted sources in range", () => expect(decideStatus("admin_csv", 1, { corroborated: false }).status).toBe("approved"));
  it("auto-approves trusted sources even with no reference yet (new series)", () => {
    const d = decideStatus("enumerator", null, { corroborated: false });
    expect(d.status).toBe("approved");
    expect(d.flags).toContain("insufficient_reference");
  });
  it("queues uncorroborated crowd prices", () => {
    const d = decideStatus("crowd", 0.5, { corroborated: false });
    expect(d).toEqual({ status: "pending", flags: ["uncorroborated"] });
  });
  it("approves corroborated in-range crowd prices", () => expect(decideStatus("crowd", 0.5, { corroborated: true }).status).toBe("approved"));
  it("queues low-trust sources", () => expect(decideStatus("source_pull", 0, { corroborated: true, sourceTrust: 0.3 }).status).toBe("pending"));
});

describe("validateObservation", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  it("rejects non-positive amounts and future dates", () => {
    expect(validateObservation({ amount: 0, observedAt: now, now }).ok).toBe(false);
    expect(validateObservation({ amount: 5, observedAt: new Date("2026-06-02T00:00:00Z"), now }).field).toBe("observedAt");
    expect(validateObservation({ amount: 5, observedAt: now, now }).ok).toBe(true);
  });
});

describe("seriesStats", () => {
  const day = (d: number, avg: number) => ({ t: new Date(Date.UTC(2026, 0, d)), avg });
  it("computes high/low/avg, WoW change and volatility", () => {
    const pts = [...Array.from({ length: 7 }, (_, i) => day(i + 1, 10)), ...Array.from({ length: 7 }, (_, i) => day(i + 8, 11))];
    const s = seriesStats(pts);
    expect(s.high).toBe(11);
    expect(s.low).toBe(10);
    expect(s.average).toBe(10.5);
    expect(s.latest).toBe(11);
    expect(s.changePctWoW).toBe(10);
    expect(s.volatility.label).toBe("low");
    expect(s.volatility.bandLow).toBeLessThan(10.5);
  });
  it("handles empty series", () => expect(seriesStats([]).volatility.label).toBe("insufficient_data"));
});
