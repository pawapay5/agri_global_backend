import { describe, expect, it } from "vitest";
import { messageRateOk, scanMessage } from "./scam.logic";

describe("scanMessage", () => {
  it("allows ordinary trade talk", () => {
    for (const t of ["Is the maize still available? I need 10 bags", "Can you deliver to Kumasi on Friday?", "I can do 450 per bag if I take 20", "Please pay through the app, thanks"])
      expect(scanMessage(t).action).toBe("allow");
  });
  it("warns on requests to pay outside the platform", () => {
    expect(scanMessage("Send the money to my MoMo number 0241234567 instead").flags).toContain("off_platform_payment");
    expect(scanMessage("pay me directly outside the app, it's cheaper").action).not.toBe("allow");
  });
  it("holds OTP / PIN harvesting outright", () => {
    const r = scanMessage("Please send me the verification code you just received");
    expect(r.action).toBe("hold");
    expect(r.flags).toContain("credential_request");
  });
  it("accumulates weaker signals", () => {
    const r = scanMessage("Urgent! Pay deposit first via western union, whatsapp me +233 24 123 4567");
    expect(r.score).toBeGreaterThanOrEqual(0.8);
    expect(r.action).toBe("hold");
  });
});

describe("messageRateOk", () => {
  it("limits bursts and new-conversation spam", () => {
    expect(messageRateOk(5, 50, 2, false).ok).toBe(true);
    expect(messageRateOk(20, 50, 2, false)).toEqual({ ok: false, code: "rate_minute" });
    expect(messageRateOk(1, 1, 30, true)).toEqual({ ok: false, code: "rate_new_conversations" });
  });
});
