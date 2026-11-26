import { Bell, Building2, ChartSpline, Code2, FileText, HandCoins, House, Lightbulb, MessageSquare, ShoppingBasket, Store, Table2, Users, Wheat, Wrench, type LucideIcon } from "lucide-react";

/**
 * Which app sections each person sees. This only shapes the menu: the API authorises every request, and pages
 * stay reachable by URL (e.g. a consumer can still open /app/sell to start selling).
 *
 * Roles: everyday users pick farmer, trader, consumer, researcher, student or policymaker; staff roles
 * (enumerator, agronomist, org_admin, admin) are granted by an admin. "Buyer" and "seller" aren't account roles:
 * they're the two sides of a marketplace order, and selling only needs a seller profile.
 */
export type NavContext = { role?: string | null; inOrg: boolean; hasShop: boolean };
export type NavItem = { href: string; key: string; icon: LucideIcon; exact?: boolean; bottom?: boolean; group: NavGroup; show?: (c: NavContext) => boolean };
export type NavGroup = "prices" | "trade" | "learn" | "data" | "account";

export const STAFF_ROLES = new Set(["admin", "org_admin", "enumerator", "agronomist"]);
/** Roles that usually sell, so Seller centre is always offered to them. */
const SELLING_ROLES = new Set(["farmer", "trader"]);
/** Roles that work with bulk data and the public API. */
const DATA_ROLES = new Set(["researcher", "policymaker", "student", "org_admin", "admin", "agronomist"]);

export const isStaff = (role?: string | null) => Boolean(role && STAFF_ROLES.has(role));
/** Whether to look up a seller profile at all: only when the role alone doesn't decide (saves a request). */
export const needsShopCheck = (role?: string | null) => !role || !SELLING_ROLES.has(role);

export const NAV: NavItem[] = [
  { href: "/app", key: "home", icon: House, exact: true, bottom: true, group: "prices" },
  { href: "/app/commodities", key: "commodities", icon: Wheat, bottom: true, group: "prices" },
  { href: "/app/markets", key: "markets", icon: Store, bottom: true, group: "prices" },
  { href: "/app/forecast", key: "forecast", icon: ChartSpline, bottom: true, group: "prices" },
  { href: "/app/alerts", key: "alerts", icon: Bell, bottom: true, group: "prices" },
  { href: "/app/marketplace", key: "marketplace", icon: ShoppingBasket, group: "trade" },
  { href: "/app/sell", key: "sell", icon: HandCoins, group: "trade", show: (c) => SELLING_ROLES.has(c.role ?? "") || c.hasShop },
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
