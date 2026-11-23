import { describe, expect, it } from "vitest";
import { conditionMet, quietHoursDelayMs, render, shouldFire } from "./alert.logic";

const base = { thresholdPerKgLocal: 10, threshold: 10, lastState: null, lastTriggeredAt: null, cooldownHours: 24 };

describe("conditionMet", () => {
  it("above/below compare against the per-kg threshold", () => {
    expect(conditionMet({ ...base, condition: "above" }, 10.5, null)!.met).toBe(true);
    expect(conditionMet({ ...base, condition: "above" }, 9.9, null)!.met).toBe(false);
    expect(conditionMet({ ...base, condition: "below" }, 9.9, null)!).toMatchObject({ met: true, direction: "below" });
  });
  it("pct_change supports rises and falls", () => {
    expect(conditionMet({ ...base, condition: "pct_change", threshold: 10 }, 112, 100)).toMatchObject({ met: true, changePct: 12, direction: "above" });
    expect(conditionMet({ ...base, condition: "pct_change", threshold: -10 }, 85, 100)).toMatchObject({ met: true, changePct: -15, direction: "below" });
    expect(conditionMet({ ...base, condition: "pct_change", threshold: -10 }, 95, 100)!.met).toBe(false);
  });
  it("pct_change needs a baseline", () => expect(conditionMet({ ...base, condition: "pct_change" }, 10, null)).toBeNull());
});

describe("shouldFire", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  it("fires on transition into the condition", () => expect(shouldFire({ ...base, lastState: false }, true, now)).toEqual({ fire: true }));
  it("is edge-triggered (no repeat while still in state)", () => expect(shouldFire({ ...base, lastState: true }, true, now)).toMatchObject({ fire: false, reason: "already_in_state" }));
  it("respects cooldown", () => {
    expect(shouldFire({ ...base, lastState: false, lastTriggeredAt: new Date("2026-06-01T01:00:00Z") }, true, now)).toMatchObject({ reason: "cooldown" });
    expect(shouldFire({ ...base, lastState: false, lastTriggeredAt: new Date("2026-05-30T01:00:00Z") }, true, now)).toEqual({ fire: true });
  });
});

describe("quietHoursDelayMs", () => {
  // Africa/Accra is UTC+0, Africa/Nairobi is UTC+3
  it("is zero outside quiet hours", () => expect(quietHoursDelayMs(new Date("2026-06-01T12:00:00Z"), "21:00", "06:00", "Africa/Accra")).toBe(0));
  it("delays until the end of an overnight window", () => {
    expect(quietHoursDelayMs(new Date("2026-06-01T23:00:00Z"), "21:00", "06:00", "Africa/Accra")).toBe(7 * 3_600_000);
    expect(quietHoursDelayMs(new Date("2026-06-01T02:30:00Z"), "21:00", "06:00", "Africa/Accra")).toBe(3.5 * 3_600_000);
  });
  it("applies the user's timezone", () => {
    // 19:00 UTC = 22:00 Nairobi, inside 21:00–06:00
    expect(quietHoursDelayMs(new Date("2026-06-01T19:00:00Z"), "21:00", "06:00", "Africa/Nairobi")).toBe(8 * 3_600_000);
  });
  it("ignores incomplete settings", () => expect(quietHoursDelayMs(new Date(), null, "06:00", "Africa/Accra")).toBe(0));
});

describe("render", () => {
  it("fills placeholders and blanks unknown keys", () => expect(render("Hi {{name}}, {{ code }}{{missing}}", { name: "Ama", code: 123456 })).toBe("Hi Ama, 123456"));
});
