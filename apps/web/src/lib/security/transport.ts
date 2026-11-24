/**
 * Whether the site is served over HTTPS, from its configured public URL (NEXT_PUBLIC_SITE_URL, set from the
 * Coolify domain). Decides two things that break a plain-HTTP deployment if they're on:
 * - `Secure` cookies (and the `__Host-` CSRF cookie): browsers drop them on http:// sites, so sign-in fails;
 * - CSP `upgrade-insecure-requests`: makes the browser load CSS/JS over https://, which fails.
 * Derived from configuration, not request headers, so a client can't switch it off. Always off in development.
 */
export const HTTPS_SITE =
  process.env.NODE_ENV === "production" && (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://");
