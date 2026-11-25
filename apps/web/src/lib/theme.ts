/** next-themes settings for the root provider (the inline script's text, and so its hash, depends on them). */
export const THEME_PROPS = { attribute: "class", defaultTheme: "system", enableSystem: true, disableTransitionOnChange: true } as const;

/**
 * SHA-256 of next-themes' inline anti-flash script as the production build emits it (Next re-minifies the
 * function, so it differs from the library's own text). The strict (nonce) CSP on /app and /admin allows it
 * by hash, since the root layout is prerendered and can't stamp a per-request nonce on it.
 * Guarded end to end: e2e/dashboard-a11y.spec.ts fails on any CSP violation on a signed-in page, which is
 * what an upgrade of next, next-themes or THEME_PROPS would cause. Recompute with the hash the browser prints.
 */
export const THEME_SCRIPT_HASH = "sha256-n46vPwSWuMC0W703pBofImv82Z26xo4LXymv0E9caPk=";
