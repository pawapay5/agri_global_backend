import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import { APP_CONFIG, AppConfig } from "../../config/config";
import { hmac, safeEqual, sixDigitCode } from "../../common/crypto/crypto";
import { AppError } from "../../common/http/problem";
import { REDIS } from "../../common/redis/redis.module";

export const OTP_TTL_SECONDS = 600;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 30;
export const OTP_HOURLY_LIMIT = 8;

export type OtpChannel = "sms" | "email";
export type OtpPurpose = "login" | "verify_email" | "verify_phone" | "reset_password";

/** Minimal Redis surface used here (keeps the service unit-testable with a fake). */
export type OtpRedis = Pick<Redis, "get" | "set" | "del" | "incr" | "expire" | "ttl">;

export function normaliseDestination(channel: OtpChannel, destination: string): string {
  const d = destination.trim();
  if (channel === "email") return d.toLowerCase();
  const phone = d.replace(/[\s()-]/g, "");
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw AppError.unprocessable("phone_invalid", "Phone numbers must be in E.164 format, e.g. +233241234567");
  return phone;
}

@Injectable()
export class OtpService {
  constructor(@Inject(REDIS) private readonly redis: OtpRedis, @Inject(APP_CONFIG) private readonly cfg: Pick<AppConfig, "otpPepper">) {}

  private keys(purpose: OtpPurpose, channel: OtpChannel, dest: string) {
    // Destination is hashed so raw phone numbers/emails never sit in Redis key names.
    const id = hmac(this.cfg.otpPepper, `${channel}:${dest}`).slice(0, 32);
    return { code: `otp:${purpose}:${id}`, attempts: `otp:${purpose}:${id}:att`, cooldown: `otp:${purpose}:${id}:cd`, hourly: `otp:hourly:${id}` };
  }

  /** Issues a new code (invalidating any previous one). Returns the plain code for dispatch only. */
  async issue(purpose: OtpPurpose, channel: OtpChannel, destination: string): Promise<{ code: string; expiresInSeconds: number; resendAfterSeconds: number }> {
    const dest = normaliseDestination(channel, destination);
    const k = this.keys(purpose, channel, dest);

    const cooled = await this.redis.set(k.cooldown, "1", "EX", OTP_RESEND_COOLDOWN_SECONDS, "NX");
    if (cooled !== "OK") {
      const ttl = Math.max(1, await this.redis.ttl(k.cooldown));
      throw AppError.tooMany("otp_cooldown", `Please wait ${ttl}s before requesting another code`, ttl);
    }
    const sent = await this.redis.incr(k.hourly);
    if (sent === 1) await this.redis.expire(k.hourly, 3600);
    if (sent > OTP_HOURLY_LIMIT) throw AppError.tooMany("otp_hourly_limit", "Too many codes requested. Try again later.", await this.redis.ttl(k.hourly));

    const code = sixDigitCode();
    await this.redis.set(k.code, hmac(this.cfg.otpPepper, `${k.code}:${code}`), "EX", OTP_TTL_SECONDS);
    await this.redis.del(k.attempts);
    return { code, expiresInSeconds: OTP_TTL_SECONDS, resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS };
  }

  /** Verifies and consumes a code. Throws a typed error on failure. */
  async verify(purpose: OtpPurpose, channel: OtpChannel, destination: string, code: string): Promise<string> {
    const dest = normaliseDestination(channel, destination);
    const k = this.keys(purpose, channel, dest);
    const stored = await this.redis.get(k.code);
    if (!stored) throw AppError.badRequest("otp_expired", "The code has expired. Request a new one.");

    const attempts = await this.redis.incr(k.attempts);
    if (attempts === 1) await this.redis.expire(k.attempts, OTP_TTL_SECONDS);
    if (attempts > OTP_MAX_ATTEMPTS) {
      await this.redis.del(k.code, k.attempts);
      throw AppError.tooMany("otp_attempts_exceeded", "Too many incorrect attempts. Request a new code.");
    }
    if (!/^\d{6}$/.test(code) || !safeEqual(stored, hmac(this.cfg.otpPepper, `${k.code}:${code}`))) {
      const left = OTP_MAX_ATTEMPTS - attempts;
      if (left <= 0) await this.redis.del(k.code, k.attempts);
      throw new AppError(400, "otp_invalid", "Bad request", "Incorrect code", { attemptsRemaining: Math.max(0, left) });
    }
    await this.redis.del(k.code, k.attempts);
    return dest;
  }
}
