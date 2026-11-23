import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHash, createHmac } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { APP_CONFIG, AppConfig } from "../../config/config";
import { AppError } from "../../common/http/problem";

export interface OAuthProfile { provider: "google" | "apple" | "facebook"; subject: string; email: string | null; emailVerified: boolean; name: string | null }

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const APPLE_JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

/** Verifies provider-issued tokens server-side. Client-supplied profile data is never trusted. */
@Injectable()
export class OAuthService {
  private readonly log = new Logger(OAuthService.name);
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async verify(provider: string, token: string, nonce?: string): Promise<OAuthProfile> {
    try {
      switch (provider) {
        case "google": return await this.google(token, nonce);
        case "apple": return await this.apple(token, nonce);
        case "facebook": return await this.facebook(token);
        default: throw AppError.badRequest("oauth_provider_unsupported");
      }
    } catch (e) {
      if (e instanceof AppError) throw e;
      this.log.warn({ provider, err: (e as Error).message }, "oauth verification failed");
      throw AppError.unauthorized("oauth_token_invalid");
    }
  }

  private async google(idToken: string, nonce?: string): Promise<OAuthProfile> {
    if (!this.cfg.oauth.googleClientIds.length) throw AppError.badRequest("oauth_provider_disabled");
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"], audience: this.cfg.oauth.googleClientIds,
    });
    if (nonce && payload.nonce !== nonce) throw AppError.unauthorized("oauth_nonce_mismatch");
    return { provider: "google", subject: payload.sub!, email: (payload.email as string) ?? null, emailVerified: payload.email_verified === true, name: (payload.name as string) ?? null };
  }

  private async apple(idToken: string, nonce?: string): Promise<OAuthProfile> {
    if (!this.cfg.oauth.appleClientIds.length) throw AppError.badRequest("oauth_provider_disabled");
    const { payload } = await jwtVerify(idToken, APPLE_JWKS, { issuer: "https://appleid.apple.com", audience: this.cfg.oauth.appleClientIds });
    if (nonce) {
      // Apple embeds either the raw nonce or SHA-256(nonce) depending on the client SDK.
      const hashed = createHash("sha256").update(nonce).digest("hex");
      if (payload.nonce !== nonce && payload.nonce !== hashed) throw AppError.unauthorized("oauth_nonce_mismatch");
    }
    const ev = payload.email_verified;
    return { provider: "apple", subject: payload.sub!, email: (payload.email as string) ?? null, emailVerified: ev === true || ev === "true", name: null };
  }

  private async facebook(accessToken: string): Promise<OAuthProfile> {
    const { facebookAppId: id, facebookAppSecret: secret } = this.cfg.oauth;
    if (!id || !secret) throw AppError.badRequest("oauth_provider_disabled");
    const debug = await fetch(`https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${id}|${secret}`);
    const d = (await debug.json()) as { data?: { is_valid?: boolean; app_id?: string; user_id?: string } };
    if (!d.data?.is_valid || d.data.app_id !== id || !d.data.user_id) throw AppError.unauthorized("oauth_token_invalid");
    const proof = createHmac("sha256", secret).update(accessToken).digest("hex");
    const me = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}&appsecret_proof=${proof}`);
    const p = (await me.json()) as { id?: string; name?: string; email?: string };
    if (p.id !== d.data.user_id) throw AppError.unauthorized("oauth_token_invalid");
    // Facebook only returns confirmed emails.
    return { provider: "facebook", subject: p.id, email: p.email ?? null, emailVerified: Boolean(p.email), name: p.name ?? null };
  }
}
