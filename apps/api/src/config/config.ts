/** Typed, validated environment configuration. Fails fast at boot. */
export interface AppConfig {
  env: "development" | "test" | "production";
  port: number;
  publicUrl: string;
  corsOrigins: string[];
  databaseUrl: string;
  redisUrl: string;
  jwt: { accessSecret: Uint8Array; issuer: string; accessTtlSeconds: number; refreshTtlDays: number };
  fieldEncryptionKey: Buffer;
  otpPepper: string;
  oauth: { googleClientIds: string[]; appleClientIds: string[]; facebookAppId?: string; facebookAppSecret?: string };
  s3: { endpoint?: string; region: string; accessKey?: string; secretKey?: string; reportsBucket: string; imagesBucket: string };
  search: { provider: "postgres" | "meilisearch"; meiliUrl?: string; meiliKey?: string };
  openMeteoUrl: string;
  mlServiceUrl: string;
  /** Farmer assistant: Claude answers from AgriPrice data; Khaya (GhanaNLP) translates and does speech. Off unless both keys are set. */
  assistant: {
    anthropicApiKey?: string; model: string; dailyLimitPerUser: number;
    khayaApiKey?: string; khayaBaseUrl: string; khayaAuth: "bearer" | "apim";
  };
}

const list = (v?: string) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function required(env: NodeJS.ProcessEnv, key: string, devDefault?: string): string {
  const v = env[key] ?? (env.NODE_ENV !== "production" ? devDefault : undefined);
  if (!v) throw new Error(`Missing required env var ${key}`);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? "development") as AppConfig["env"];
  const accessSecret = required(env, "JWT_ACCESS_SECRET", "dev-only-access-secret-change-me-32bytes!!");
  if (accessSecret.length < 32) throw new Error("JWT_ACCESS_SECRET must be at least 32 characters");
  const fek = Buffer.from(required(env, "FIELD_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64")), "base64");
  if (fek.length !== 32) throw new Error("FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  const searchProvider = (env.SEARCH_PROVIDER ?? "postgres") as AppConfig["search"]["provider"];

  return {
    env: nodeEnv,
    port: Number(env.API_PORT ?? 3001),
    publicUrl: env.API_PUBLIC_URL ?? "http://localhost:3001",
    corsOrigins: list(env.CORS_ORIGINS ?? "http://localhost:3000"),
    databaseUrl: required(env, "DATABASE_URL", "postgres://agriprice:agriprice@localhost:5432/agriprice"),
    redisUrl: required(env, "REDIS_URL", "redis://localhost:6379"),
    jwt: {
      accessSecret: new TextEncoder().encode(accessSecret),
      issuer: env.JWT_ISSUER ?? "agriprice",
      accessTtlSeconds: Number(env.JWT_ACCESS_TTL_SECONDS ?? 900),
      refreshTtlDays: Number(env.REFRESH_TTL_DAYS ?? 30),
    },
    fieldEncryptionKey: fek,
    otpPepper: required(env, "OTP_PEPPER", "dev-otp-pepper"),
    oauth: {
      googleClientIds: list(env.GOOGLE_CLIENT_IDS),
      appleClientIds: list(env.APPLE_CLIENT_IDS),
      facebookAppId: env.FACEBOOK_APP_ID || undefined,
      facebookAppSecret: env.FACEBOOK_APP_SECRET || undefined,
    },
    s3: {
      endpoint: env.S3_ENDPOINT || undefined,
      region: env.S3_REGION ?? "us-east-1",
      accessKey: env.S3_ACCESS_KEY || undefined,
      secretKey: env.S3_SECRET_KEY || undefined,
      reportsBucket: env.S3_BUCKET_REPORTS ?? "agriprice-reports",
      imagesBucket: env.S3_BUCKET_IMAGES ?? "agriprice-images",
    },
    search: { provider: searchProvider, meiliUrl: env.MEILI_URL, meiliKey: env.MEILI_KEY },
    assistant: {
      anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
      model: env.ASSISTANT_MODEL || "claude-opus-5-5",
      dailyLimitPerUser: Math.max(0, Number(env.ASSISTANT_DAILY_LIMIT || 20)),
      khayaApiKey: env.KHAYA_API_KEY || undefined,
      khayaBaseUrl: (env.KHAYA_BASE_URL || "https://api.khaya.ai").replace(/\/+$/, ""),
      khayaAuth: env.KHAYA_AUTH === "apim" ? "apim" : "bearer",
    },
    openMeteoUrl: env.OPEN_METEO_URL ?? "https://api.open-meteo.com/v1/forecast",
    mlServiceUrl: env.ML_SERVICE_URL ?? "http://localhost:8001",
  };
}

export const APP_CONFIG = Symbol("APP_CONFIG");
