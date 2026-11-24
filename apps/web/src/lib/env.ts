import "server-only";

/** Server-only configuration. Nothing here is exposed to the browser. */
export const env = {
  apiUrl: (process.env.AGRIPRICE_API_URL ?? "http://localhost:3001").replace(/\/$/, ""),
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  revalidateSecret: process.env.REVALIDATE_SECRET ?? "",
  isProd: process.env.NODE_ENV === "production",
};
