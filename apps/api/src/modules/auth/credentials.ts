import * as argon2 from "argon2";
import { authenticator } from "otplib";
import { randomBytes } from "node:crypto";
import { hmac } from "../../common/crypto/crypto";

// OWASP 2024 baseline for argon2id: m=19 MiB, t=2, p=1.
const ARGON = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (pw: string) => argon2.hash(pw, ARGON);
export async function verifyPassword(hash: string | null, pw: string): Promise<boolean> {
  // Always do the work so response time doesn't reveal whether the account exists.
  const h = hash ?? (await dummyHash());
  try { return (await argon2.verify(h, pw)) && hash !== null; } catch { return false; }
}
export const needsRehash = (hash: string) => argon2.needsRehash(hash, ARGON);
let dummy: Promise<string> | undefined;
const dummyHash = () => (dummy ??= argon2.hash(randomBytes(16).toString("hex"), ARGON));

/** Rejects the most common weak passwords. A breached-password API can be added later. */
export function passwordProblem(pw: string, email?: string | null): string | null {
  if (pw.length < 10) return "Password must be at least 10 characters";
  if (/^(.)\1+$/.test(pw)) return "Password is too repetitive";
  const lower = pw.toLowerCase();
  if (["password", "1234567890", "qwertyuiop", "agriprice"].some((w) => lower.includes(w))) return "Password is too common";
  if (email && lower.includes(email.split("@")[0]!.toLowerCase()) && email.split("@")[0]!.length >= 4) return "Password must not contain your email name";
  return null;
}

// ── TOTP (RFC 6238) ──
authenticator.options = { step: 30, window: 1, digits: 6 };
export const totp = {
  secret: () => authenticator.generateSecret(20),
  url: (account: string, secret: string) => authenticator.keyuri(account, "AgriPrice", secret),
  check: (code: string, secret: string) => authenticator.check(code, secret),
};

/** 10 recovery codes, formatted xxxxx-xxxxx; stored as HMAC hashes. */
export function generateRecoveryCodes(n = 10): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: n }, () => {
    const b = randomBytes(10);
    const s = [...b].map((x) => alphabet[x % alphabet.length]).join("");
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}
export const hashRecoveryCode = (pepper: string, code: string) => hmac(pepper, `recovery:${code.trim().toLowerCase()}`);
