import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { AuthUser } from "../../common/auth/auth.common";
import { AuditService } from "../../common/audit/audit.service";
import { DRIZZLE, Db, Sql } from "../../common/db/database.module";
import { consents, farmingProfiles, userInterests, userPreferences } from "../../common/db/schema";
import { AppError } from "../../common/http/problem";
import type { ClientMeta } from "../../common/http/request-context";
import { SessionService } from "../auth/session.service";
import { toUserDto, UsersRepository } from "./users.repository";
import type { ConsentUpdateDto, FarmingProfileDto, InterestsDto, PreferencesDto, SavedLocationCreateDto, UserUpdateDto } from "./users.dto";

export const DELETION_GRACE_DAYS = 30;

@Injectable()
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly sql: Sql,
    @Inject(DRIZZLE) private readonly db: Db,
  ) {}

  async me(u: AuthUser) { return toUserDto(await this.repo.mustGet(u.id)); }

  async update(u: AuthUser, dto: UserUpdateDto, client: ClientMeta) {
    const current = await this.repo.mustGet(u.id);
    // Privileged roles (enumerator/admin/org_admin) are granted by admins only; don't let users self-demote out of them silently either.
    if (dto.role && ["enumerator", "admin", "org_admin"].includes(current.role)) throw AppError.forbidden("role_managed_by_admin");
    if (dto.country) await this.repo.assertCountry(dto.country);
    const updated = await this.repo.update(u.id, {
      ...(dto.fullName !== undefined && { fullName: dto.fullName }),
      ...(dto.role !== undefined && { role: dto.role }),
      ...(dto.country !== undefined && { countryIso2: dto.country }),
      ...(dto.avatarUrl !== undefined && { avatarUrl: dto.avatarUrl }),
    });
    await this.audit.record({ actorId: u.id, action: "user.profile.updated", data: { fields: Object.keys(dto) } }, client);
    return toUserDto(updated);
  }

  // ── deletion (30-day grace; hard delete + anonymisation runs in workers/account-deletion) ──
  async requestDeletion(u: AuthUser, client: ClientMeta) {
    const at = new Date(Date.now() + DELETION_GRACE_DAYS * 86_400_000);
    await this.repo.update(u.id, { deletionRequestedAt: new Date(), deletionScheduledAt: at });
    await this.sql.exec(`UPDATE alerts SET active = false WHERE user_id = $1`, [u.id]);
    await this.sessions.revokeAll(u.id, "account_deletion");
    await this.audit.record({ actorId: u.id, action: "account.deletion.requested", data: { scheduledAt: at.toISOString() } }, client);
    return { deletionScheduledAt: at.toISOString() };
  }

  async cancelDeletion(u: AuthUser, client: ClientMeta) {
    await this.repo.update(u.id, { deletionRequestedAt: null, deletionScheduledAt: null });
    await this.audit.record({ actorId: u.id, action: "account.deletion.cancelled" }, client);
  }

  // ── farming profile ──
  async getFarming(u: AuthUser) {
    const r = await this.db.query.farmingProfiles.findFirst({ where: eq(farmingProfiles.userId, u.id) });
    return {
      cropIds: r?.cropIds ?? [], farmSize: r?.farmSize != null ? Number(r.farmSize) : null, areaUnit: r?.areaUnit ?? null,
      farmingType: r?.farmingType ?? null, regionId: r?.regionId ?? null, yearsOfExperience: r?.yearsOfExperience ?? null,
    };
  }

  async putFarming(u: AuthUser, dto: FarmingProfileDto) {
    if (dto.cropIds?.length) await this.assertIds("commodities", dto.cropIds);
    if (dto.regionId) await this.assertIds("regions", [dto.regionId]);
    const values = {
      userId: u.id, cropIds: dto.cropIds ?? [], farmSize: dto.farmSize != null ? String(dto.farmSize) : null, areaUnit: dto.areaUnit ?? null,
      farmingType: dto.farmingType ?? null, regionId: dto.regionId ?? null, yearsOfExperience: dto.yearsOfExperience ?? null, updatedAt: new Date(),
    };
    await this.db.insert(farmingProfiles).values(values).onConflictDoUpdate({ target: farmingProfiles.userId, set: values });
    return this.getFarming(u);
  }

  // ── preferences ──
  async getPrefs(u: AuthUser) {
    const r = await this.db.query.userPreferences.findFirst({ where: eq(userPreferences.userId, u.id) });
    const c = await this.sql.one<{ currency: string; default_unit: string; default_locale: string }>(
      `SELECT c.currency, c.default_unit, c.default_locale FROM users u JOIN countries c ON c.iso2 = u.country_iso2 WHERE u.id = $1`, [u.id]);
    return {
      locale: r?.locale ?? c?.default_locale ?? "en", currency: r?.currency ?? c?.currency ?? "USD", unit: r?.unit ?? c?.default_unit ?? "kg",
      theme: r?.theme ?? "system", defaultRegionId: r?.defaultRegionId ?? null, defaultPriceType: r?.defaultPriceType ?? "wholesale",
    };
  }

  async putPrefs(u: AuthUser, dto: PreferencesDto) {
    if (dto.currency && !(await this.sql.one(`SELECT 1 FROM currencies WHERE code = $1`, [dto.currency]))) throw AppError.unprocessable("currency_unsupported", dto.currency);
    if (dto.unit && !(await this.sql.one(`SELECT 1 FROM units WHERE code = $1`, [dto.unit]))) throw AppError.unprocessable("unit_unknown", dto.unit);
    if (dto.defaultRegionId) await this.assertIds("regions", [dto.defaultRegionId]);
    const set = {
      ...(dto.locale !== undefined && { locale: dto.locale }), ...(dto.currency !== undefined && { currency: dto.currency }),
      ...(dto.unit !== undefined && { unit: dto.unit }), ...(dto.theme !== undefined && { theme: dto.theme }),
      ...(dto.defaultRegionId !== undefined && { defaultRegionId: dto.defaultRegionId }),
      ...(dto.defaultPriceType !== undefined && { defaultPriceType: dto.defaultPriceType }), updatedAt: new Date(),
    };
    await this.db.insert(userPreferences).values({ userId: u.id, ...set }).onConflictDoUpdate({ target: userPreferences.userId, set });
    return this.getPrefs(u);
  }

  // ── interests ──
  async getInterests(u: AuthUser) {
    const r = await this.db.query.userInterests.findFirst({ where: eq(userInterests.userId, u.id) });
    return { commodityIds: r?.commodityIds ?? [], marketIds: r?.marketIds ?? [], topics: r?.topics ?? [] };
  }
  async putInterests(u: AuthUser, dto: InterestsDto) {
    if (dto.commodityIds?.length) await this.assertIds("commodities", dto.commodityIds);
    if (dto.marketIds?.length) await this.assertIds("markets", dto.marketIds);
    const values = { userId: u.id, commodityIds: dto.commodityIds ?? [], marketIds: dto.marketIds ?? [], topics: dto.topics ?? [], updatedAt: new Date() };
    await this.db.insert(userInterests).values(values).onConflictDoUpdate({ target: userInterests.userId, set: values });
    return this.getInterests(u);
  }

  // ── saved locations (PostGIS) ──
  async listLocations(u: AuthUser) {
    const rows = await this.sql.many<{ id: string; label: string; lat: number; lng: number; region_id: string | null; is_default: boolean; created_at: Date }>(
      `SELECT id, label, ST_Y(point::geometry) AS lat, ST_X(point::geometry) AS lng, region_id, is_default, created_at
       FROM saved_locations WHERE user_id = $1 ORDER BY is_default DESC, created_at`, [u.id]);
    return rows.map((r) => ({ id: r.id, label: r.label, point: { lat: r.lat, lng: r.lng }, regionId: r.region_id, isDefault: r.is_default, createdAt: r.created_at.toISOString() }));
  }

  async createLocation(u: AuthUser, dto: SavedLocationCreateDto) {
    const count = await this.sql.one<{ n: number }>(`SELECT count(*)::int AS n FROM saved_locations WHERE user_id = $1`, [u.id]);
    if ((count?.n ?? 0) >= 20) throw AppError.unprocessable("location_limit", "You can save up to 20 locations");
    const row = await this.sql.tx(async (c) => {
      if (dto.isDefault) await c.query(`UPDATE saved_locations SET is_default = false WHERE user_id = $1`, [u.id]);
      // Region is resolved by point-in-polygon against the deepest admin level available.
      const r = await c.query<{ id: string }>(
        `INSERT INTO saved_locations (user_id, label, point, region_id, is_default)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography,
                 (SELECT id FROM regions WHERE geom IS NOT NULL AND ST_Contains(geom, ST_SetSRID(ST_MakePoint($4, $3), 4326)) ORDER BY level DESC LIMIT 1),
                 $5)
         RETURNING id`, [u.id, dto.label, dto.point.lat, dto.point.lng, dto.isDefault ?? false]);
      return r.rows[0]!;
    });
    return (await this.listLocations(u)).find((l) => l.id === row.id)!;
  }

  async deleteLocation(u: AuthUser, id: string) {
    const n = await this.sql.exec(`DELETE FROM saved_locations WHERE id = $1 AND user_id = $2`, [id, u.id]);
    if (!n) throw AppError.notFound("location");
  }

  // ── consents (append-only ledger) ──
  async getConsents(u: AuthUser) {
    const rows = await this.sql.many<{ type: string; granted: boolean; version: string; created_at: Date }>(
      `SELECT DISTINCT ON (type) type, granted, version, created_at FROM consents WHERE user_id = $1 ORDER BY type, created_at DESC`, [u.id]);
    return rows.map((r) => ({ type: r.type, granted: r.granted, version: r.version, updatedAt: r.created_at.toISOString() }));
  }

  async putConsents(u: AuthUser, dto: ConsentUpdateDto, client: ClientMeta) {
    if (dto.consents.some((c) => (c.type === "terms" || c.type === "privacy") && !c.granted))
      throw AppError.unprocessable("consent_required", "Terms and privacy consent can only be withdrawn by deleting the account");
    await this.db.insert(consents).values(dto.consents.map((c) => ({ userId: u.id, type: c.type, granted: c.granted, version: c.version, ip: client.ip, userAgent: client.userAgent })));
    await this.audit.record({ actorId: u.id, action: "user.consents.updated", data: { consents: dto.consents } }, client);
    return this.getConsents(u);
  }

  private async assertIds(table: "commodities" | "regions" | "markets", ids: string[]) {
    const r = await this.sql.one<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE id = ANY($1::uuid[])`, [ids]);
    if ((r?.n ?? 0) !== new Set(ids).size) throw AppError.unprocessable(`${table}_unknown`, `One or more ${table} were not found`);
  }
}
