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

// Coolify passes ${VAR:-} as an empty string when a variable is left blank: treat blank exactly like unset.
const val = (v) => (typeof v === "string" && v.trim() !== "" ? v : undefined);

export function readAdminConfig(env, fallbackCountry = "GH") {
  const email = (val(env.ADMIN_EMAIL) ?? "").trim().toLowerCase();
  const password = val(env.ADMIN_PASSWORD) ?? "";
  if (!email && !password) return { skip: "ADMIN_EMAIL and ADMIN_PASSWORD are not set" };
  if (!EMAIL.test(email) || email.length > 254) return { error: "ADMIN_EMAIL is not a valid email address" };
  if (!password) return { error: "ADMIN_PASSWORD is required with ADMIN_EMAIL" };
  const problem = passwordProblem(password, email);
  if (problem) return { error: `ADMIN_PASSWORD ${problem}` };
  const country = (val(env.ADMIN_COUNTRY) ?? val(fallbackCountry) ?? "GH").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return { error: "ADMIN_COUNTRY must be a two-letter country code, e.g. GH" };
  const name = (val(env.ADMIN_NAME) ?? "").trim().slice(0, 120) || "Administrator";
  const reset = /^(1|true|yes)$/i.test(env.ADMIN_PASSWORD_RESET ?? "");
  return { email, password, country, name, reset };
}

/** Country codes to load on first deploy (SEED_COUNTRIES="gh,ng"); defaults to Ghana. */
export function seedCountries(env) {
  const raw = (val(env.SEED_COUNTRIES) ?? "gh").trim();
  if (/^(none|off|false|0)$/i.test(raw)) return [];
  return [...new Set(raw.split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z]{2}$/.test(s)))];
}

/**
 * The pipelines' login (used to post imports to the API). Created as an enumerator: the least privilege that can
 * import prices, limited to its own country. Skipped when either variable is blank.
 */
export function readServiceConfig(env, fallbackCountry = "GH") {
  const email = (val(env.PIPELINE_SERVICE_EMAIL) ?? "").trim().toLowerCase();
  const password = val(env.PIPELINE_SERVICE_PASSWORD) ?? "";
  if (!email || !password) return { skip: "PIPELINE_SERVICE_EMAIL / PIPELINE_SERVICE_PASSWORD are not set" };
  if (!EMAIL.test(email)) return { error: "PIPELINE_SERVICE_EMAIL is not a valid email address" };
  const problem = passwordProblem(password, email);
  if (problem) return { error: `PIPELINE_SERVICE_PASSWORD ${problem}` };
  const country = (val(env.ADMIN_COUNTRY) ?? val(fallbackCountry) ?? "GH").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return { error: "ADMIN_COUNTRY must be a two-letter country code, e.g. GH" };
  return { email, password, country };
}
