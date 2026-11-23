/**
 * Drizzle mapping for tables the API writes through the ORM.
 * DDL is owned by /migrations (reversible SQL). Hypertables, continuous aggregates
 * and PostGIS reads go through `Sql` with hand-written queries.
 */
import {
  boolean, customType, inet, integer, jsonb, numeric, pgTable, real, smallint, text, time, timestamp, uuid, bigint,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const citext = customType<{ data: string }>({ dataType: () => "citext" });
/** geography(Point) written as EWKT and read back via ST_AsGeoJSON in raw queries. */
const geogPoint = customType<{ data: string }>({ dataType: () => "geography(Point, 4326)" });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: citext("email"),
  phone: text("phone"),
  emailVerifiedAt: ts("email_verified_at"),
  phoneVerifiedAt: ts("phone_verified_at"),
  passwordHash: text("password_hash"),
  fullName: text("full_name"),
  avatarUrl: text("avatar_url"),
  role: text("role").notNull().default("farmer"),
  countryIso2: text("country_iso2").notNull(),
  organisationId: uuid("organisation_id"),
  totpSecretEnc: text("totp_secret_enc"),
  totpPendingEnc: text("totp_pending_enc"),
  totpEnabledAt: ts("totp_enabled_at"),
  passwordChangedAt: ts("password_changed_at"),
  deletionRequestedAt: ts("deletion_requested_at"),
  deletionScheduledAt: ts("deletion_scheduled_at"),
  lastLoginAt: ts("last_login_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
export type UserRow = typeof users.$inferSelect;

export const oauthIdentities = pgTable("oauth_identities", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  provider: text("provider").notNull(),
  subject: text("subject").notNull(),
  email: citext("email"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  installationId: text("installation_id").notNull(),
  platform: text("platform").notNull(),
  name: text("name"),
  appVersion: text("app_version"),
  pushToken: text("push_token"),
  lastIp: inet("last_ip"),
  userAgent: text("user_agent"),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  revokedAt: ts("revoked_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type DeviceRow = typeof devices.$inferSelect;

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  deviceId: uuid("device_id"),
  familyId: uuid("family_id").notNull(),
  parentId: uuid("parent_id"),
  tokenHash: bytea("token_hash").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  revokedAt: ts("revoked_at"),
  revokedReason: text("revoked_reason"),
  ip: inet("ip"),
  userAgent: text("user_agent"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;

export const recoveryCodes = pgTable("recovery_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  codeHash: text("code_hash").notNull(),
  usedAt: ts("used_at"),
});

export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id").primaryKey(),
  locale: text("locale"),
  currency: text("currency"),
  unit: text("unit"),
  theme: text("theme").notNull().default("system"),
  defaultRegionId: uuid("default_region_id"),
  defaultPriceType: text("default_price_type").notNull().default("wholesale"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const farmingProfiles = pgTable("farming_profiles", {
  userId: uuid("user_id").primaryKey(),
  cropIds: uuid("crop_ids").array().notNull().default([]),
  farmSize: numeric("farm_size"),
  areaUnit: text("area_unit"),
  farmingType: text("farming_type"),
  regionId: uuid("region_id"),
  yearsOfExperience: smallint("years_of_experience"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const userInterests = pgTable("user_interests", {
  userId: uuid("user_id").primaryKey(),
  commodityIds: uuid("commodity_ids").array().notNull().default([]),
  marketIds: uuid("market_ids").array().notNull().default([]),
  topics: text("topics").array().notNull().default([]),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const savedLocations = pgTable("saved_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  label: text("label").notNull(),
  point: geogPoint("point").notNull(),
  regionId: uuid("region_id"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const consents = pgTable("consents", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid("user_id").notNull(),
  type: text("type").notNull(),
  granted: boolean("granted").notNull(),
  version: text("version").notNull(),
  ip: inet("ip"),
  userAgent: text("user_agent"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const alerts = pgTable("alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  commodityId: uuid("commodity_id").notNull(),
  marketId: uuid("market_id"),
  regionId: uuid("region_id"),
  countryIso2: text("country_iso2").notNull(),
  priceType: text("price_type").notNull().default("wholesale"),
  condition: text("condition").notNull(),
  threshold: numeric("threshold").notNull(),
  thresholdCurrency: text("threshold_currency"),
  thresholdUnit: text("threshold_unit"),
  thresholdPerKgLocal: numeric("threshold_per_kg_local"),
  pctWindowDays: smallint("pct_window_days").notNull().default(7),
  channels: text("channels").array().notNull(),
  cooldownHours: smallint("cooldown_hours").notNull().default(24),
  active: boolean("active").notNull().default(true),
  lastState: boolean("last_state"),
  lastTriggeredAt: ts("last_triggered_at"),
  triggerCount: integer("trigger_count").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
export type AlertRow = typeof alerts.$inferSelect;

export const alertEvents = pgTable("alert_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  alertId: uuid("alert_id").notNull(),
  userId: uuid("user_id").notNull(),
  commodityId: uuid("commodity_id").notNull(),
  marketId: uuid("market_id"),
  condition: text("condition").notNull(),
  observedValue: numeric("observed_value").notNull(),
  threshold: numeric("threshold").notNull(),
  changePct: real("change_pct"),
  direction: text("direction").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  deliveredChannels: text("delivered_channels").array().notNull().default([]),
  suppressedReason: text("suppressed_reason"),
  triggeredAt: ts("triggered_at").notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  category: text("category").notNull(),
  templateKey: text("template_key"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  dedupeKey: text("dedupe_key"),
  readAt: ts("read_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id").primaryKey(),
  categories: jsonb("categories").$type<Record<string, string[]>>().notNull().default({}),
  quietStart: time("quiet_start"),
  quietEnd: time("quiet_end"),
  timezone: text("timezone"),
  whatsappNumber: text("whatsapp_number"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const notificationDeliveries = pgTable("notification_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  notificationId: uuid("notification_id").notNull(),
  userId: uuid("user_id").notNull(),
  channel: text("channel").notNull(),
  provider: text("provider").notNull(),
  status: text("status").notNull().default("queued"),
  providerMessageId: text("provider_message_id"),
  attempts: smallint("attempts").notNull().default(0),
  lastError: text("last_error"),
  sentAt: ts("sent_at"),
  deliveredAt: ts("delivered_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
