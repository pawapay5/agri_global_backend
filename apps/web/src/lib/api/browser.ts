"use client";
import createClient, { type Middleware } from "openapi-fetch";
import { CSRF_HEADER, readCsrfCookie } from "@/lib/security/csrf";
import type { components, paths } from "./schema";

export type S = components["schemas"];

/** Problem details thrown by every client call so TanStack Query surfaces them as errors. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly detail?: string, readonly problem?: Record<string, unknown>) {
    super(detail ?? code);
  }
}

const prefs: Middleware = {
  onRequest({ request }) {
    // Display preferences override the user's saved ones (spec: X-Currency / X-Units headers).
    try {
      const currency = localStorage.getItem("ap_currency"), unit = localStorage.getItem("ap_unit");
      if (currency) request.headers.set("X-Currency", currency);
      if (unit) { request.headers.set("X-Units", unit); request.headers.set("X-Unit", unit); }
    } catch { /* storage unavailable */ }
    request.headers.set("Accept-Language", document.documentElement.lang || "en");
    if (request.method !== "GET" && request.method !== "HEAD") {
      const csrf = readCsrfCookie(document.cookie);
      if (csrf) request.headers.set(CSRF_HEADER, csrf);
    }
    return request;
  },
};

/** Same-origin client: calls go to /api/v1/* (the BFF), which attaches the httpOnly session. */
export const api = createClient<paths>({ baseUrl: "/api", credentials: "same-origin" });
api.use(prefs);

/** Unwraps openapi-fetch results; throws ApiError on problem+json. */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await p;
  if (error !== undefined || !response.ok) {
    const e = (error ?? {}) as { code?: string; detail?: string };
    if (response.status === 401 && typeof window !== "undefined" && location.pathname.includes("/app")) {
      const locale = location.pathname.split("/")[1] ?? "en";
      location.assign(`/${locale}/login?next=${encodeURIComponent(location.pathname + location.search)}`);
    }
    throw new ApiError(response.status, e.code ?? `http_${response.status}`, e.detail, error as Record<string, unknown>);
  }
  return data as T;
}

export function idempotencyKey() { return crypto.randomUUID(); }
