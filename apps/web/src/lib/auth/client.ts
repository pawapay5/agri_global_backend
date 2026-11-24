"use client";
import { CSRF_HEADER, readCsrfCookie } from "@/lib/security/csrf";

export interface Problem { status: number; code: string; detail?: string; attemptsRemaining?: number; retryAfterSeconds?: number }
export type AuthResponse = { status: "authenticated" | "mfa_required" | "verification_required"; isNewUser?: boolean };

/** POST to our own BFF (/api/auth/*). Tokens never come back to the browser; only status. */
export async function bff<T = AuthResponse>(path: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; problem: Problem }> {
  try {
    const res = await fetch(`/api/auth/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", "Accept-Language": document.documentElement.lang || "en", [CSRF_HEADER]: readCsrfCookie(document.cookie) ?? "" },
      body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin",
    });
    if (res.status === 204) return { ok: true, data: undefined as T };
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, problem: { status: res.status, code: json.code ?? `http_${res.status}`, detail: json.detail, attemptsRemaining: json.attemptsRemaining, retryAfterSeconds: json.retryAfterSeconds } };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, problem: { status: 0, code: "network" } };
  }
}

/** Only allow same-site relative redirects after login (prevents open redirects). */
export function safeNext(next: string | null, locale: string): string {
  if (next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")) return next;
  return `/${locale}/app`;
}
