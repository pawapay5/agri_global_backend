export function passwordProblem(pw, email) {
  if (typeof pw !== "string" || pw.length < 10) return "must be at least 10 characters";
  if (/^(.)\1+$/.test(pw)) return "is too repetitive";
  const lower = pw.toLowerCase();
  if (["password", "1234567890", "qwertyuiop", "agriprice"].some((w) => lower.includes(w))) return "is too common";
  const local = email ? email.split("@")[0] : "";
  if (local && local.length >= 4 && lower.includes(local.toLowerCase())) return "must not contain the email name";
  return null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function readAdminConfig(env, fallbackCountry = "GH") {
  const email = (env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = env.ADMIN_PASSWORD ?? "";
  if (!email && !password) return { skip: "ADMIN_EMAIL and ADMIN_PASSWORD are not set" };
  if (!EMAIL.test(email) || email.length > 254) return { error: "ADMIN_EMAIL is not a valid email address" };
  if (!password) return { error: "ADMIN_PASSWORD is required with ADMIN_EMAIL" };
  const problem = passwordProblem(password, email);
  if (problem) return { error: `ADMIN_PASSWORD ${problem}` };
  const country = (env.ADMIN_COUNTRY ?? fallbackCountry).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return { error: "ADMIN_COUNTRY must be a two-letter country code, e.g. GH" };
  const name = (env.ADMIN_NAME ?? "").trim().slice(0, 120) || "Administrator";
  const reset = /^(1|true|yes)$/i.test(env.ADMIN_PASSWORD_RESET ?? "");
  return { email, password, country, name, reset };
}

/** Country codes to load on first deploy (SEED_COUNTRIES="gh,ng"); defaults to Ghana. */
export function seedCountries(env) {
  const raw = (env.SEED_COUNTRIES ?? "gh").trim();
  if (/^(none|off|false|0)$/i.test(raw)) return [];
  return [...new Set(raw.split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z]{2}$/.test(s)))];
}
