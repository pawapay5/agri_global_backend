/**
 * Double-submit CSRF token, on top of SameSite=Lax cookies and the Origin check.
 * The proxy issues a random token in a JS-readable cookie; the browser echoes it in X-CSRF-Token on every
 * mutating request to our BFF; the BFF compares the two in constant time. `__Host-` in production pins the
 * cookie to our exact origin (Secure, Path=/, no Domain), so a sibling subdomain can't plant one.
 */
export const CSRF_HEADER = "x-csrf-token";
export const csrfCookieName = (secure: boolean) => (secure ? "__Host-ap_csrf" : "ap_csrf");

export function newCsrfToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function tokensMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a.length !== b.length || a.length < 32) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Browser side: read the token for the header. Both names are tried so dev (http) and prod work. */
export function readCsrfCookie(cookieString: string): string | null {
  for (const part of cookieString.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === "__Host-ap_csrf" || k === "ap_csrf") return decodeURIComponent(v.join("="));
  }
  return null;
}
