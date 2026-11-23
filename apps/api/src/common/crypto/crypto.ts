import { Inject, Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { APP_CONFIG, AppConfig } from "../../config/config";

/** AES-256-GCM for secrets at rest (TOTP seeds). Format: v1.<iv>.<tag>.<ciphertext> (base64url). */
@Injectable()
export class FieldCipher {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.cfg.fieldEncryptionKey, iv);
    const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
  }

  decrypt(blob: string): string {
    const [v, iv, tag, ct] = blob.split(".");
    if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unsupported ciphertext");
    const d = createDecipheriv("aes-256-gcm", this.cfg.fieldEncryptionKey, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  }
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest();
export const hmac = (key: string, s: string) => createHmac("sha256", key).update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
/** Uniform 6-digit code using rejection-free CSPRNG integers. */
export const sixDigitCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
