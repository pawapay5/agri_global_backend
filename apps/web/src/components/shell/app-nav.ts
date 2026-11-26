import { BadgeCheck, Bell, Building2, ChartSpline, Code2, FileText, HandCoins, House, Lightbulb, MessageSquare, Sparkles, ShoppingBasket, Store, Table2, Users, Wheat, Wrench, type LucideIcon } from "lucide-react";

/**
 * Which app sections each person sees. This only shapes the menu: the API authorises every request, and pages
 * stay reachable by URL (e.g. a consumer can still open /app/sell to start selling).
 *
 * Roles: everyday users pick farmer, trader, consumer, researcher, student or policymaker; staff roles
 * (enumerator, agronomist, org_admin, admin) are granted by an admin. Everyone starts as a buyer. Selling is a status,
 * not a role: a user applies with their ID documents and an admin approves them (`seller: "verified"`). Until then the
 * menu offers "Become a seller" instead of the Seller centre.
 */
export type SellerStatus = "none" | "pending" | "verified" | "rejected";
export type NavContext = { role?: string | null; inOrg: boolean; seller: SellerStatus };
export type NavItem = { href: string; key: string; icon: LucideIcon; exact?: boolean; bottom?: boolean; group: NavGroup; show?: (c: NavContext) => boolean };
export type NavGroup = "prices" | "trade" | "learn" | "data" | "account";

export const STAFF_ROLES = new Set(["admin", "org_admin", "enumerator", "agronomist"]);
/** Roles that work with bulk data and the public API. */
const DATA_ROLES = new Set(["researcher", "policymaker", "student", "org_admin", "admin", "agronomist"]);

export const isStaff = (role?: string | null) => Boolean(role && STAFF_ROLES.has(role));
/** Staff work from the admin console, so they aren't offered the seller application. */
export const needsShopCheck = (role?: string | null) => !isStaff(role);
/** Seller status from the seller-profile lookup: no profile (404) means they haven't applied. */
export const sellerStatus = (profile?: { kycStatus?: string | null } | null): SellerStatus => {
  const k = profile?.kycStatus;
  return k === "pending" || k === "verified" || k === "rejected" ? k : "none";
};

export const NAV: NavItem[] = [
  { href: "/app", key: "home", icon: House, exact: true, bottom: true, group: "prices" },
  { href: "/app/commodities", key: "commodities", icon: Wheat, bottom: true, group: "prices" },
  { href: "/app/markets", key: "markets", icon: Store, bottom: true, group: "prices" },
  { href: "/app/forecast", key: "forecast", icon: ChartSpline, bottom: true, group: "prices" },
  { href: "/app/alerts", key: "alerts", icon: Bell, bottom: true, group: "prices" },
  { href: "/app/assistant", key: "assistant", icon: Sparkles, group: "prices" },
  { href: "/app/marketplace", key: "marketplace", icon: ShoppingBasket, group: "trade" },
  { href: "/app/sell", key: "sell", icon: HandCoins, group: "trade", show: (c) => c.seller === "verified" },
  { href: "/app/sell", key: "becomeSeller", icon: BadgeCheck, group: "trade", show: (c) => c.seller !== "verified" && !isStaff(c.role) },
  { href: "/app/messages", key: "messages", icon: MessageSquare, group: "trade" },
  { href: "/app/insights", key: "insights", icon: Lightbulb, group: "learn" },
  { href: "/app/tools", key: "tools", icon: Wrench, group: "learn" },
  { href: "/app/community", key: "community", icon: Users, group: "learn" },
  { href: "/app/reports", key: "reports", icon: FileText, group: "data", show: (c) => c.role !== "consumer" },
  { href: "/app/data", key: "data", icon: Table2, group: "data", show: (c) => c.role !== "consumer" },
  { href: "/app/developers", key: "developers", icon: Code2, group: "data", show: (c) => DATA_ROLES.has(c.role ?? "") },
  { href: "/app/org", key: "org", icon: Building2, group: "account", show: (c) => c.inOrg || c.role === "org_admin" },
];

export const GROUPS: NavGroup[] = ["prices", "trade", "learn", "data", "account"];

/** The sidebar for one person, grouped, with empty groups dropped (exported for tests). */
export function navFor(c: NavContext) {
  return GROUPS.map((g) => ({ group: g, items: NAV.filter((n) => n.group === g && (!n.show || n.show(c))) })).filter((g) => g.items.length);
}
