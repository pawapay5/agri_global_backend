/**
 * Content-Security-Policy.
 *
 * - Signed-in and admin areas (`/app`, `/admin`) render per request, so they get a strict nonce policy:
 *   `script-src 'nonce-…' 'strict-dynamic'`. Next.js reads the nonce from the request's CSP header and
 *   stamps it on its own scripts; scripts they load inherit trust through 'strict-dynamic'.
 * - Public and auth pages are prerendered and served from cache, where no per-request nonce can exist
 *   (Next.js docs: nonces require dynamic rendering and are incompatible with PPR). They use the same
 *   policy minus the nonce, which means `script-src 'self' 'unsafe-inline'` for Next's inline bootstrap
 *   scripts. Those pages hold no session data or tokens (httpOnly cookies), and every other directive
 *   stays strict (no third-party script hosts except configured sign-in providers, no framing, no plugins).
 */
const SIGN_IN = {
  script: ["https://accounts.google.com/gsi/client", "https://appleid.cdn-apple.com"],
  frame: ["https://accounts.google.com", "https://appleid.apple.com"],
  connect: ["https://accounts.google.com"],
};

export function buildCsp({ nonce, dev = process.env.NODE_ENV !== "production" }: { nonce?: string; dev?: boolean } = {}): string {
  const extraConnect = (process.env.CSP_CONNECT_SRC ?? "").split(/[\s,]+/).filter(Boolean);
  const script = nonce
    ? [`'nonce-${nonce}'`, "'strict-dynamic'", "'self'", ...SIGN_IN.script]
    : ["'self'", "'unsafe-inline'", ...SIGN_IN.script];
  if (dev) script.push("'unsafe-eval'"); // React dev tooling / Fast Refresh

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": script,
    // React and chart libraries set style attributes; style injection is far lower risk than script.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...SIGN_IN.connect, "https://tiles.openfreemap.org", ...extraConnect, ...(dev ? ["ws:"] : [])],
    "worker-src": ["'self'", "blob:"], // MapLibre workers
    "frame-src": SIGN_IN.frame,
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "report-uri": ["/api/csp-report"],
  };
  const policy = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`).join("; ");
  return dev ? policy : `${policy}; upgrade-insecure-requests`;
}

export function newNonce(): string {
  return btoa(crypto.randomUUID());
}
