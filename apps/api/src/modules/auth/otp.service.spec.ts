import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../common/http/problem";
import { FakeRedis } from "../../test-utils/fake-redis";
import { normaliseDestination, OTP_MAX_ATTEMPTS, OtpService } from "./otp.service";

const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as AppError).code; } };

describe("OtpService", () => {
  let redis: FakeRedis; let svc: OtpService; let t: number;
  beforeEach(() => {
    redis = new FakeRedis(); t = 1_700_000_000_000; redis.now = () => t;
    svc = new OtpService(redis as never, { otpPepper: "pepper" });
  });

  it("issues a 6-digit code and verifies it once", async () => {
    const { code: c, expiresInSeconds, resendAfterSeconds } = await svc.issue("login", "sms", "+233 24 123 4567");
    expect(c).toMatch(/^\d{6}$/);
    expect(expiresInSeconds).toBe(600);
    expect(resendAfterSeconds).toBe(30);
    await expect(svc.verify("login", "sms", "+233241234567", c)).resolves.toBe("+233241234567");
    expect(await code(svc.verify("login", "sms", "+233241234567", c))).toBe("otp_expired"); // consumed
  });

  it("enforces the 30s resend cooldown", async () => {
    await svc.issue("login", "email", "a@b.co");
    expect(await code(svc.issue("login", "email", "A@B.co"))).toBe("otp_cooldown");
    t += 31_000;
    expect(await code(svc.issue("login", "email", "a@b.co"))).toBe("ok");
  });

  it("expires after 10 minutes", async () => {
    const { code: c } = await svc.issue("verify_email", "email", "x@y.z");
    t += 601_000;
    expect(await code(svc.verify("verify_email", "email", "x@y.z", c))).toBe("otp_expired");
  });

  it("locks after 5 wrong attempts even if the right code follows", async () => {
    const { code: c } = await svc.issue("login", "email", "x@y.z");
    const wrong = c === "000000" ? "111111" : "000000";
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) expect(await code(svc.verify("login", "email", "x@y.z", wrong))).toBe("otp_invalid");
    expect(await code(svc.verify("login", "email", "x@y.z", c))).toBe("otp_expired");
  });

  it("a fresh code resets attempts", async () => {
    await svc.issue("login", "email", "x@y.z");
    await code(svc.verify("login", "email", "x@y.z", "999999"));
    t += 31_000;
    const { code: c2 } = await svc.issue("login", "email", "x@y.z");
    await expect(svc.verify("login", "email", "x@y.z", c2)).resolves.toBe("x@y.z");
  });

  it("validates E.164 phone numbers", () => {
    expect(normaliseDestination("sms", "+233 (24) 123-4567")).toBe("+233241234567");
    expect(() => normaliseDestination("sms", "0241234567")).toThrow();
  });
});
