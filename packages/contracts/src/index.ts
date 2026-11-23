export type { paths, components, operations } from "./generated/schema.js";
import type { components } from "./generated/schema.js";

export type Schemas = components["schemas"];
export type PriceType = Schemas["PriceType"];
export type Role = Schemas["Role"];
export type Channel = Schemas["Channel"];
export type NotificationCategory = Schemas["NotificationCategory"];
export type AlertCondition = Schemas["AlertCondition"];
export type ConfidenceLabel = Schemas["ConfidenceLabel"];

export const PRICE_TYPES = ["retail", "wholesale", "farm_gate"] as const satisfies readonly PriceType[];
export const CHANNELS = ["push", "email", "sms", "whatsapp", "in_app"] as const satisfies readonly Channel[];
export const NOTIFICATION_CATEGORIES = [
  "price_alert", "market_update", "weather", "system", "weekly_insight",
] as const satisfies readonly NotificationCategory[];
export const ROLES = [
  "farmer", "trader", "consumer", "researcher", "student", "policymaker", "enumerator", "admin", "org_admin",
] as const satisfies readonly Role[];
