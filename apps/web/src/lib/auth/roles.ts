/** Staff roles are granted by an admin and work from the admin console. Client-safe: no cookie or token code here. */
export const STAFF_ROLES = ["admin", "org_admin", "enumerator", "agronomist"] as const;
export const isStaffRole = (role?: string | null) => Boolean(role && (STAFF_ROLES as readonly string[]).includes(role));
