import { THEME_SCRIPT_HASH } from "@/lib/theme";

const PROVIDERS = {
  google: { script: ["https://accounts.google.com/gsi/client"], frame: ["https://accounts.google.com"], connect: ["https://accounts.google.com"] },
  apple: { script: ["https://appleid.cdn-apple.com"], frame: ["https://appleid.apple.com"], connect: [] },
  facebook: { script: ["https://connect.facebook.net"], frame: ["https://www.facebook.com", "https://web.facebook.com"], connect: ["https://graph.facebook.com", "https://www.facebook.com"] },
} as const;

// NEXT_PUBLIC_* are inlined at build, so each lookup must be a literal property access.
const CONFIGURED: Record<keyof typeof PROVIDERS, boolean> = {
  google: Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID),
  apple: Boolean(process.env.NEXT_PUBLIC_APPLE_SERVICE_ID),
  facebook: Boolean(process.env.NEXT_PUBLIC_FACEBOOK_APP_ID),
};

function signInHosts(enabled: Record<keyof typeof PROVIDERS, boolean>) {
  const on = (Object.keys(PROVIDERS) as (keyof typeof PROVIDERS)[]).filter((k) => enabled[k]).map((k) => PROVIDERS[k]);
  return { script: on.flatMap((p) => p.script), frame: on.flatMap((p) => p.frame), connect: on.flatMap((p) => p.connect) };
}

export function buildCsp({ nonce, dev = process.env.NODE_ENV !== "production", https = !dev, providers = CONFIGURED }: {
  nonce?: string; dev?: boolean; https?: boolean; providers?: Record<keyof typeof PROVIDERS, boolean>;
} = {}): string {
  const SIGN_IN = signInHosts(providers);
  const extraConnect = (process.env.CSP_CONNECT_SRC ?? "").split(/[\s,]+/).filter(Boolean);
  const script = nonce
    ? [`'nonce-${nonce}'`, `'${THEME_SCRIPT_HASH}'`, "'strict-dynamic'", "'self'", ...SIGN_IN.script]
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
    "frame-src": SIGN_IN.frame.length ? SIGN_IN.frame : ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "report-uri": ["/api/csp-report"],
  };
  const policy = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`).join("; ");
  return https ? `${policy}; upgrade-insecure-requests` : policy;
}

export function newNonce(): string {
  return btoa(crypto.randomUUID());
}
