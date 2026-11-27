import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, ValidateIf } from "class-validator";
import { AuthUser, CurrentUser, RoleName, Roles } from "../../common/auth/auth.common";
import { AuditService } from "../../common/audit/audit.service";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { cursor } from "../../common/http/request-context";
import { QueueService } from "../../common/queue/queues";
import { Cache } from "../../common/redis/redis.module";
import { PagedQuery, upperIso } from "../geo/geo.dto";
import { GeoService } from "../geo/geo.service";
import { GeoModule } from "../geo/geo.module";
import { SessionService } from "../auth/session.service";
import { AuthModule } from "../auth/auth.module";
import { toUserDto, UsersRepository } from "../users/users.repository";
import { FieldCipher } from "../../common/crypto/crypto";
import { KycReviewController, KycReviewService } from "./kyc-review";
import { AdminStatsController, AdminStatsService } from "./admin-stats";

/**
 * Allow-list for generic admin CRUD. Column names are validated against this list and
 * information_schema, never interpolated from user input unchecked. `country` marks
 * tables an org_admin may edit (rows scoped to their own country).
 */
const TABLES: Record<string, { pk: string; country?: string; jsonCols?: string[]; readonly?: string[]; geo?: boolean }> = {
  commodity_categories: { pk: "id", jsonCols: ["name"] },
  commodities: { pk: "id", jsonCols: ["name"], readonly: ["search"] },
  varieties: { pk: "id", jsonCols: ["name"] },
  units: { pk: "code", jsonCols: ["name"] },
  commodity_unit_conversions: { pk: "id", country: "country_iso2" },
  crop_calendars: { pk: "id", country: "country_iso2" },
  markets: { pk: "id", country: "country_iso2", jsonCols: ["name"], readonly: ["search", "location"], geo: true },
  regions: { pk: "id", country: "country_iso2", jsonCols: ["name"], readonly: ["geom", "centroid"] },
  data_sources: { pk: "id", country: "country_iso2", jsonCols: ["config"] },
  agro_advice_rules: { pk: "id", country: "country_iso2", jsonCols: ["condition"] },
  export_requirements: { pk: "id", jsonCols: ["title", "description"] },
  notification_templates: { pk: "id" },
  plans: { pk: "code", jsonCols: ["name", "prices", "entitlements", "provider_ids"] },
  commission_rules: { pk: "id", country: "country_iso2" },
  faqs: { pk: "id", country: "country_iso2", jsonCols: ["question", "answer"] },
  success_stories: { pk: "id", country: "country_iso2", jsonCols: ["title", "body"] },
  help_articles: { pk: "id", country: "country_iso2", jsonCols: ["title", "body"] },
  app_config: { pk: "id", country: "country_iso2", jsonCols: ["value"] },
  crop_guides: { pk: "id", country: "country_iso2", jsonCols: ["title", "summary", "sections"], readonly: ["version", "reviewed_by", "reviewed_at"] },
  pest_diseases: { pk: "id", country: "country_iso2", jsonCols: ["name", "symptoms", "photos", "organic_control", "chemical_control", "prevention"], readonly: ["version", "reviewed_by", "reviewed_at", "search"] },
  fertiliser_products: { pk: "id", country: "country_iso2", jsonCols: ["name"] },
  fertiliser_rules: { pk: "id", country: "country_iso2", jsonCols: ["applications", "notes"], readonly: ["version", "reviewed_by", "reviewed_at"] },
  programmes: { pk: "id", country: "country_iso2", jsonCols: ["title", "body", "eligibility"], readonly: ["version"] },
  training_items: { pk: "id", country: "country_iso2", jsonCols: ["title", "body"], readonly: ["version", "location"] },
  input_suppliers: { pk: "id", country: "country_iso2", jsonCols: ["description"], readonly: ["version", "location"] },
  holidays: { pk: "id", country: "country_iso2", jsonCols: ["name"] },
};
const KNOWLEDGE = new Set(["crop_guides", "pest_diseases", "fertiliser_products", "fertiliser_rules", "programmes", "training_items", "input_suppliers"]);
const REVIEWABLE = new Set(["crop_guides", "pest_diseases", "fertiliser_rules"]);
const ADMIN_ONLY = new Set(["plans", "commission_rules", "units", "notification_templates", "export_requirements"]);

export const ALL_ROLES = ["farmer", "trader", "consumer", "researcher", "student", "policymaker", "enumerator", "agronomist", "org_admin", "admin"] as const;
/** What an org admin may hand out: everyday roles plus field enumerators. Staff above that are granted by an admin. */
export const ORG_ADMIN_ASSIGNABLE = ["farmer", "trader", "consumer", "researcher", "student", "policymaker", "enumerator"] as const;

/** Who may give which role (exported for tests). Admins can grant any role; org admins only everyday roles and enumerators. */
export function canAssign(actorRole: string, role: string) {
  return actorRole === "admin" ? (ALL_ROLES as readonly string[]).includes(role) : actorRole === "org_admin" && (ORG_ADMIN_ASSIGNABLE as readonly string[]).includes(role);
}

class TableQuery extends PagedQuery { @IsOptional() @IsString() @MaxLength(100) q?: string }
class UsersQuery extends PagedQuery {
  @IsOptional() @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country?: string;
  @IsOptional() @IsIn(ALL_ROLES) role?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}
class AdminUserUpdateDto {
  @IsOptional() @IsIn(ALL_ROLES) role?: RoleName;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() organisationId?: string | null;
  @IsOptional() @IsBoolean() suspended?: boolean;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
class AdminUserCreateDto {
  @IsString() @Length(2, 120) fullName: string;
  @IsEmail() @MaxLength(254) email: string;
  @IsOptional() @Matches(/^\+[1-9]\d{7,14}$/) phone?: string;
  @IsIn(ALL_ROLES) role: RoleName;
  @IsOptional() @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country?: string;
}
class BroadcastDto {
  @Matches(/^[A-Z]{2}$/) country: string;
  @IsOptional() @IsArray() roles?: string[];
  @IsOptional() @IsArray() @IsUUID("all", { each: true }) regionIds?: string[];
  @IsOptional() @IsArray() @IsUUID("all", { each: true }) commodityIds?: string[];
  @IsIn(["price_alert", "market_update", "weather", "system", "weekly_insight"]) category: "price_alert" | "market_update" | "weather" | "system" | "weekly_insight";
  @IsString() @Length(1, 120) title: string;
  @IsString() @Length(1, 1000) body: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsIn(["push", "email", "sms", "whatsapp", "in_app"], { each: true }) channels?: ("push" | "email" | "sms" | "whatsapp" | "in_app")[];
}
class AuditQuery extends PagedQuery {
  @IsOptional() @IsUUID() actor_id?: string;
  @IsOptional() @IsString() @MaxLength(80) action?: string;
  @IsOptional() @IsString() @MaxLength(40) entity?: string;
  @IsOptional() @IsISO8601() from?: string;
}
class ModQuery extends PagedQuery { @IsOptional() @IsIn(["listing", "message", "post", "comment", "user", "price"]) target_type?: string }
class ReviewDto { @IsOptional() @IsBoolean() publish?: boolean; @IsOptional() @IsString() @MaxLength(500) note?: string }
class ModDecisionDto { @IsIn(["none", "hide", "remove", "warn_user", "suspend_user"]) action: string; @IsOptional() @IsString() @MaxLength(500) note?: string }

@Injectable()
export class AdminService {
  private colCache = new Map<string, Set<string>>();
  constructor(private readonly sql: Sql, private readonly audit: AuditService, private readonly queue: QueueService, private readonly cache: Cache,
    private readonly users: UsersRepository, private readonly sessions: SessionService, private readonly geo: GeoService) {}

  private table(name: string, actor: AuthUser) {
    const t = TABLES[name];
    if (!t) throw AppError.notFound("table");
    if (actor.role === "org_admin" && (ADMIN_ONLY.has(name) || !t.country)) throw AppError.forbidden("admin_only_table");
    if (actor.role === "agronomist" && !KNOWLEDGE.has(name)) throw AppError.forbidden("knowledge_tables_only");
    return t;
  }

  private async columns(name: string): Promise<Set<string>> {
    let c = this.colCache.get(name);
    if (!c) {
      c = new Set((await this.sql.many<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [name])).map((r) => r.column_name));
      this.colCache.set(name, c);
    }
    return c;
  }

  private async clean(name: string, body: Record<string, unknown>, creating: boolean) {
    const t = TABLES[name]!; const cols = await this.columns(name);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      const col = k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`); // accept camelCase
      if (!cols.has(col) || (t.readonly ?? []).includes(col) || ["created_at", "updated_at"].includes(col) || (col === t.pk && !creating && t.pk === "id")) {
        throw AppError.unprocessable("column_invalid", `Unknown or read-only column '${k}'`);
      }
      out[col] = (t.jsonCols ?? []).includes(col) && v !== null ? JSON.stringify(v) : v;
    }
    if (!Object.keys(out).length) throw AppError.unprocessable("empty_body", "Nothing to change");
    return out;
  }

  async list(actor: AuthUser, name: string, q: TableQuery) {
    const t = this.table(name, actor);
    const off = cursor.decode<{ o: number }>(q.cursor)?.o ?? 0;
    const where: string[] = []; const args: unknown[] = [];
    if ((actor.role === "org_admin" || actor.role === "agronomist") && t.country) { args.push(actor.country); where.push(`${t.country} = $${args.length}`); }
    if (q.q) { args.push(`%${q.q}%`); where.push(`row_to_json(t)::text ILIKE $${args.length}`); }
    args.push(q.limit + 1, off);
    const rows = await this.sql.many(`SELECT * FROM ${name} t ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${t.pk} LIMIT $${args.length - 1} OFFSET $${args.length}`, args);
    return { data: rows.slice(0, q.limit).map((r) => { delete (r as Record<string, unknown>).search; return r; }), nextCursor: rows.length > q.limit ? cursor.encode({ o: off + q.limit }) : null };
  }

  async create(actor: AuthUser, name: string, body: Record<string, unknown>) {
    const t = this.table(name, actor);
    const v = await this.clean(name, body, true);
    if ((actor.role === "org_admin" || actor.role === "agronomist") && t.country) v[t.country] = actor.country;
    const cols = Object.keys(v);
    const row = await this.sql.one(`INSERT INTO ${name} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, Object.values(v))
      .catch((e) => { throw AppError.unprocessable("db_constraint", (e as Error).message.split("\n")[0]!); });
    await this.audit.record({ actorId: actor.id, action: `admin.${name}.create`, entity: name, entityId: String(row![t.pk]), data: body });
    await this.cache.del("cat:categories");
    return row;
  }

  async update(actor: AuthUser, name: string, id: string, body: Record<string, unknown>) {
    const t = this.table(name, actor);
    const v = await this.clean(name, body, false);
    if ((actor.role === "org_admin" || actor.role === "agronomist") && t.country) delete v[t.country];
    const cols = Object.keys(v);
    const scope = (actor.role === "org_admin" || actor.role === "agronomist") && t.country ? ` AND ${t.country} = $${cols.length + 2}` : "";
    const row = await this.sql.one(`UPDATE ${name} SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")} WHERE ${t.pk} = $${cols.length + 1}${scope} RETURNING *`,
      [...Object.values(v), id, ...(scope ? [actor.country] : [])]).catch((e) => { throw AppError.unprocessable("db_constraint", (e as Error).message.split("\n")[0]!); });
    if (!row) throw AppError.notFound("row");
    await this.audit.record({ actorId: actor.id, action: `admin.${name}.update`, entity: name, entityId: id, data: body });
    return row;
  }

  async remove(actor: AuthUser, name: string, id: string) {
    const t = this.table(name, actor);
    const scope = (actor.role === "org_admin" || actor.role === "agronomist") && t.country ? ` AND ${t.country} = $2` : "";
    const n = await this.sql.exec(`DELETE FROM ${name} WHERE ${t.pk} = $1${scope}`, [id, ...(scope ? [actor.country] : [])])
      .catch(() => { throw AppError.conflict("row_in_use", "This row is referenced by other data; deactivate it instead"); });
    if (!n) throw AppError.notFound("row");
    await this.audit.record({ actorId: actor.id, action: `admin.${name}.delete`, entity: name, entityId: id });
  }

  /** Agronomist sign-off (the reviewer can't be the last editor's own unreviewed draft trick: sign-off is tied to the current version). */
  async review(actor: AuthUser, table: string, id: string, d: { publish?: boolean; note?: string }) {
    if (!REVIEWABLE.has(table)) throw AppError.notFound("table");
    if (!["agronomist", "admin"].includes(actor.role)) throw AppError.forbidden("agronomist_required");
    // Set reviewed_* explicitly; the versioning trigger keeps them because they changed in this UPDATE.
    const row = await this.sql.one(
      `UPDATE ${table} SET reviewed_by = $2, reviewed_at = now(), status = CASE WHEN $4 THEN 'published' ELSE status END
       WHERE id = $1 AND ($3::char(2) IS NULL OR country_iso2 = $3) RETURNING *`,
      [id, actor.id, actor.role === "agronomist" ? actor.country : null, d.publish !== false]);
    if (!row) throw AppError.notFound("row");
    await this.audit.record({ actorId: actor.id, action: `knowledge.${table}.reviewed`, entity: table, entityId: id, data: { version: (row as { version: number }).version, note: d.note } });
    return row;
  }

  async revisions(actor: AuthUser, table: string, id: string) {
    this.table(table, actor);
    const rows = await this.sql.many<{ version: number; data: unknown; edited_at: Date }>(
      `SELECT version, data, edited_at FROM knowledge_revisions WHERE entity = $1 AND entity_id = $2 ORDER BY version DESC LIMIT 100`, [table, id]);
    return rows.map((r) => ({ version: r.version, data: r.data, editedAt: r.edited_at.toISOString() }));
  }

  async updateCountry(actor: AuthUser, iso2: string, body: Record<string, unknown>) {
    const allowed = ["name", "brand_name", "default_locale", "locales", "default_unit", "area_unit", "timezone", "phone_prefix", "region_levels", "bbox", "config", "active"];
    if (actor.role === "org_admin" && actor.country !== iso2.toUpperCase()) throw AppError.forbidden("country_scope");
    const v = Object.fromEntries(Object.entries(body).map(([k, val]) => [k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`), val]));
    for (const k of Object.keys(v)) if (!allowed.includes(k) || (actor.role === "org_admin" && ["active", "config"].includes(k))) throw AppError.unprocessable("column_invalid", k);
    if (v.timezone) { try { new Intl.DateTimeFormat("en", { timeZone: String(v.timezone) }); } catch { throw AppError.unprocessable("timezone_invalid", String(v.timezone)); } }
    const cols = Object.keys(v);
    if (!cols.length) throw AppError.unprocessable("empty_body", "Nothing to change");
    const vals = cols.map((c) => (["name", "region_levels", "config"].includes(c) ? JSON.stringify(v[c]) : v[c]));
    // config is merged so a partial PATCH can't wipe other keys.
    const sets = cols.map((c, i) => (c === "config" ? `config = config || $${i + 1}::jsonb` : `${c} = $${i + 1}`));
    const n = await this.sql.exec(`UPDATE countries SET ${sets.join(", ")} WHERE iso2 = $${cols.length + 1}`, [...vals, iso2.toUpperCase()]);
    if (!n) throw AppError.notFound("country");
    await this.audit.record({ actorId: actor.id, action: "admin.country_pack.update", entity: "country", entityId: iso2.toUpperCase(), data: body });
    return this.geo.country(iso2);
  }

  async listUsers(actor: AuthUser, q: UsersQuery) {
    const country = actor.role === "org_admin" ? actor.country : q.country ?? null;
    const c = cursor.decode<{ t: string; id: string }>(q.cursor);
    const rows = await this.sql.many<{ id: string; email: string | null; phone: string | null; full_name: string | null; role: string; country_iso2: string; suspended_at: Date | null; created_at: Date; last_login_at: Date | null }>(
      `SELECT id, email, phone, full_name, role, country_iso2, suspended_at, created_at, last_login_at FROM users
       WHERE ($1::char(2) IS NULL OR country_iso2 = $1) AND ($2::text IS NULL OR role = $2)
         AND ($3::text IS NULL OR email ILIKE '%' || $3 || '%' OR phone LIKE '%' || $3 || '%' OR full_name ILIKE '%' || $3 || '%')
         AND ($4::timestamptz IS NULL OR (created_at, id) < ($4, $5::uuid)) ORDER BY created_at DESC, id DESC LIMIT $6`,
      [country, q.role ?? null, q.q ?? null, c?.t ?? null, c?.id ?? null, q.limit + 1]);
    const page = rows.slice(0, q.limit); const last = page[page.length - 1];
    return { data: page, nextCursor: rows.length > q.limit && last ? cursor.encode({ t: last.created_at.toISOString(), id: last.id }) : null };
  }

  async updateUser(actor: AuthUser, id: string, d: AdminUserUpdateDto) {
    const u = await this.users.mustGet(id);
    if (id === actor.id) throw AppError.forbidden("self_edit", "Use another admin account to change your own role or status");
    if (actor.role === "org_admin") {
      if (u.countryIso2 !== actor.country || (actor.orgId && u.organisationId !== actor.orgId)) throw AppError.forbidden("scope", "You can only manage people in your own country");
      if (!canAssign("org_admin", u.role)) throw AppError.forbidden("scope", "Only an admin can change staff accounts");
    }
    if (d.role && !canAssign(actor.role, d.role)) throw AppError.forbidden("role_not_assignable", "You can't give that role");
    const patch: Record<string, unknown> = {};
    if (d.role) patch.role = d.role;
    if (d.organisationId !== undefined) patch.organisationId = d.organisationId;
    const updated = Object.keys(patch).length ? await this.users.update(id, patch) : u;
    if (d.suspended !== undefined) {
      await this.sql.exec(`UPDATE users SET suspended_at = CASE WHEN $2 THEN now() ELSE NULL END, suspended_reason = $3 WHERE id = $1`, [id, d.suspended, d.reason ?? null]);
      if (d.suspended) {
        await this.sessions.revokeAll(id, "suspended");
        await this.sql.exec(`UPDATE listings SET status = 'removed' WHERE seller_id = $1 AND status IN ('active','low_stock')`, [id]);
      }
    }
    // Role changes must take effect immediately, so end existing sessions (the JWT carries the role).
    if (d.role && d.role !== u.role) await this.sessions.revokeAll(id, "role_changed");
    await this.audit.record({ actorId: actor.id, action: "admin.user.update", entity: "user", entityId: id, data: d as Record<string, unknown> });
    return toUserDto(updated);
  }

  async createUser(actor: AuthUser, d: AdminUserCreateDto) {
    if (!canAssign(actor.role, d.role)) throw AppError.forbidden("role_not_assignable", "You can't give that role");
    const country = actor.role === "admin" ? (d.country ?? actor.country) : actor.country;
    const email = d.email.trim().toLowerCase();
    if (await this.sql.one(`SELECT 1 FROM users WHERE lower(email) = $1`, [email])) throw AppError.conflict("account_exists", "Someone already has an account with this email");
    const u = await this.users.create({ email, fullName: d.fullName.trim(), phone: d.phone ?? null, role: d.role, countryIso2: country,
      ...(actor.role === "org_admin" && actor.orgId ? { organisationId: actor.orgId } : {}) } as never);
    const web = (process.env.WEB_URL ?? "https://agriprice.app").replace(/\/+$/, "");
    const link = `${web}/en/forgot-password?email=${encodeURIComponent(email)}`;
    await this.queue.dispatch({
      userId: u.id, category: "system", templateKey: "account.invited", channels: ["email", "in_app"],
      params: { title: "You've been added to AgriPrice", body: `${actor.role === "admin" ? "An AgriPrice admin" : "Your organisation's admin"} has created an account for you (${d.role.replace("_", " ")}). To sign in, set your password here: ${link}` },
      data: { link }, dedupeKey: `invite:${u.id}`,
    });
    await this.audit.record({ actorId: actor.id, action: "admin.user.create", entity: "user", entityId: u.id, data: { role: d.role, country } });
    return toUserDto(u);
  }

  async broadcast(actor: AuthUser, d: BroadcastDto) {
    if (actor.role === "org_admin" && d.country !== actor.country) throw AppError.forbidden("country_scope");
    const ids = await this.sql.many<{ id: string }>(
      `SELECT u.id FROM users u LEFT JOIN farming_profiles fp ON fp.user_id = u.id LEFT JOIN user_interests ui ON ui.user_id = u.id
       WHERE u.country_iso2 = $1 AND u.deletion_scheduled_at IS NULL AND u.suspended_at IS NULL
         AND ($2::text[] IS NULL OR u.role = ANY($2)) AND ($3::uuid[] IS NULL OR fp.region_id = ANY($3) OR region_ancestor_at_level(fp.region_id, 1) = ANY($3))
         AND ($4::uuid[] IS NULL OR fp.crop_ids && $4 OR ui.commodity_ids && $4)`,
      [d.country, d.roles?.length ? d.roles : null, d.regionIds?.length ? d.regionIds : null, d.commodityIds?.length ? d.commodityIds : null]);
    const batch = `bc_${Date.now()}`;
    for (const { id } of ids) {
      await this.queue.dispatch({ userId: id, category: d.category, templateKey: "broadcast", params: { title: d.title, body: d.body }, channels: d.channels, dedupeKey: `${batch}:${id}` });
    }
    await this.audit.record({ actorId: actor.id, action: "admin.broadcast", data: { ...d, recipients: ids.length } as Record<string, unknown> });
    return { recipients: ids.length };
  }

  async models() {
    const versions = await this.sql.many(`SELECT id, name, version, algorithm, status, metrics, trained_at, mlflow_run_id FROM model_versions ORDER BY trained_at DESC LIMIT 20`);
    const prod = versions.find((v) => (v as { status: string }).status === "production") as { id: string } | undefined;
    const worst = prod ? await this.sql.many(
      `SELECT b.commodity_id, c.code AS commodity, b.market_id, b.region_id, b.price_type, b.horizon_months, b.mape, b.coverage_p10_p90, b.n_folds
       FROM backtest_metrics b JOIN commodities c ON c.id = b.commodity_id WHERE b.model_version_id = $1 ORDER BY b.mape DESC LIMIT 25`, [prod.id]) : [];
    const confidence = await this.sql.many(`SELECT p.horizon_months, p.confidence, count(*)::int AS n FROM forecast_points p JOIN forecast_runs r ON r.id = p.forecast_id WHERE r.is_latest GROUP BY 1, 2 ORDER BY 1, 2`);
    const pipelines = await this.sql.many(`SELECT DISTINCT ON (flow, country_iso2) flow, country_iso2, status, started_at, finished_at, stats, error FROM pipeline_runs ORDER BY flow, country_iso2, started_at DESC`);
    return { versions, worstSeries: worst, confidenceDistribution: confidence, pipelines };
  }

  async auditLog(q: AuditQuery) {
    const c = cursor.decode<{ t: string; id: string }>(q.cursor);
    const rows = await this.sql.many<{ at: Date; id: string }>(
      `SELECT at, id, actor_id, action, entity, entity_id, host(ip) AS ip, request_id, data FROM audit_log
       WHERE ($1::uuid IS NULL OR actor_id = $1) AND ($2::text IS NULL OR action LIKE $2 || '%') AND ($3::text IS NULL OR entity = $3)
         AND at >= coalesce($4::timestamptz, now() - interval '30 days') AND ($5::timestamptz IS NULL OR (at, id) < ($5, $6::uuid))
       ORDER BY at DESC, id DESC LIMIT $7`, [q.actor_id ?? null, q.action ?? null, q.entity ?? null, q.from ?? null, c?.t ?? null, c?.id ?? null, q.limit + 1]);
    const page = rows.slice(0, q.limit); const last = page[page.length - 1];
    return { data: page, nextCursor: rows.length > q.limit && last ? cursor.encode({ t: last.at.toISOString(), id: last.id }) : null };
  }

  async moderationQueue(q: ModQuery) {
    const c = cursor.decode<{ t: string; id: string }>(q.cursor);
    const rows = await this.sql.many<{ created_at: Date; id: string }>(
      `SELECT m.*, (SELECT count(*) FROM moderation_items x WHERE x.target_type = m.target_type AND x.target_id = m.target_id AND x.status = 'open')::int AS open_reports
       FROM moderation_items m WHERE m.status = 'open' AND ($1::text IS NULL OR m.target_type = $1)
         AND ($2::timestamptz IS NULL OR (m.created_at, m.id) > ($2, $3::uuid)) ORDER BY m.created_at, m.id LIMIT $4`, [q.target_type ?? null, c?.t ?? null, c?.id ?? null, q.limit + 1]);
    const page = rows.slice(0, q.limit); const last = page[page.length - 1];
    return { data: page, nextCursor: rows.length > q.limit && last ? cursor.encode({ t: last.created_at.toISOString(), id: last.id }) : null };
  }

  async decide(actor: AuthUser, id: string, d: ModDecisionDto) {
    const m = await this.sql.one<{ target_type: string; target_id: string; reason: string }>(`SELECT target_type, target_id, reason FROM moderation_items WHERE id = $1 AND status = 'open'`, [id]);
    if (!m) throw AppError.notFound("moderation_item");
    const ownerSql: Record<string, string> = {
      listing: `SELECT seller_id AS owner FROM listings WHERE id = $1`, post: `SELECT author_id AS owner FROM posts WHERE id = $1`,
      comment: `SELECT author_id AS owner FROM comments WHERE id = $1`, message: `SELECT sender_id AS owner FROM messages WHERE id = $1`,
      user: `SELECT id AS owner FROM users WHERE id = $1`, price: `SELECT submitted_by AS owner FROM price_observations WHERE id = $1 LIMIT 1`,
    };
    const owner = (await this.sql.one<{ owner: string | null }>(ownerSql[m.target_type]!, [m.target_id]))?.owner ?? null;
    if (d.action === "hide" || d.action === "remove") {
      const st = d.action === "hide" ? "hidden" : "removed";
      if (m.target_type === "post") await this.sql.exec(`UPDATE posts SET status = $2 WHERE id = $1`, [m.target_id, st]);
      if (m.target_type === "comment") await this.sql.exec(`UPDATE comments SET status = $2 WHERE id = $1`, [m.target_id, st]);
      if (m.target_type === "listing") await this.sql.exec(`UPDATE listings SET status = 'removed' WHERE id = $1`, [m.target_id]);
      if (m.target_type === "message") await this.sql.exec(`UPDATE messages SET body = NULL, payload = '{}', flags = flags || '{removed_by_moderator}' WHERE id = $1`, [m.target_id]);
      if (m.target_type === "price") await this.sql.exec(`UPDATE price_observations SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_reason = 'moderation' WHERE id = $1`, [m.target_id, actor.id]);
      if (owner && m.target_type !== "user") await this.sql.exec(`INSERT INTO reputation_events (user_id, kind, points, ref_id) VALUES ($1,'post_removed',-20,$2) ON CONFLICT DO NOTHING`, [owner, m.target_id]);
    } else if (d.action === "suspend_user" && owner) {
      await this.updateUser(actor, owner, { suspended: true, reason: d.note ?? m.reason });
    } else if (d.action === "warn_user" && owner) {
      await this.queue.dispatch({ userId: owner, category: "system", templateKey: "moderation.warning", params: { title: "Community guidelines", body: d.note ?? "Some of your content broke our community guidelines." }, dedupeKey: `warn:${id}` });
    }
    if (m.target_type === "post" && d.action === "none") await this.sql.exec(`UPDATE posts SET status = 'visible' WHERE id = $1 AND status = 'pending_review'`, [m.target_id]);
    // Close every open report for the same target in one decision.
    await this.sql.exec(`UPDATE moderation_items SET status = $3, action = $4, decided_by = $2, decided_at = now() WHERE target_type = $5 AND target_id = $6 AND status = 'open'`,
      [id, actor.id, d.action === "none" ? "dismissed" : "actioned", d.action, m.target_type, m.target_id]);
    await this.audit.record({ actorId: actor.id, action: "admin.moderation.decide", entity: m.target_type, entityId: m.target_id, data: { action: d.action, note: d.note } });
  }
}

@ApiTags("admin")
@ApiBearerAuth()
@Roles("admin", "org_admin", "agronomist")
@Controller("v1/admin")
export class AdminController {
  constructor(private readonly a: AdminService) {}

  @Get("tables/:table") @ApiOperation({ operationId: "admin_table_list" })
  list(@CurrentUser() u: AuthUser, @Param("table") t: string, @Query() q: TableQuery) { return this.a.list(u, t, q); }

  @Post("tables/:table") @ApiOperation({ operationId: "admin_table_create" })
  create(@CurrentUser() u: AuthUser, @Param("table") t: string, @Body() b: Record<string, unknown>) { return this.a.create(u, t, b); }

  @Patch("tables/:table/:id") @ApiOperation({ operationId: "admin_table_update" })
  update(@CurrentUser() u: AuthUser, @Param("table") t: string, @Param("id") id: string, @Body() b: Record<string, unknown>) { return this.a.update(u, t, id, b); }

  @Delete("tables/:table/:id") @HttpCode(204) @ApiOperation({ operationId: "admin_table_delete" })
  async remove(@CurrentUser() u: AuthUser, @Param("table") t: string, @Param("id") id: string) { await this.a.remove(u, t, id); }

  @Roles("admin", "org_admin") @Patch("country-packs/:iso2") @ApiOperation({ operationId: "admin_country_pack_update" })
  country(@CurrentUser() u: AuthUser, @Param("iso2") iso2: string, @Body() b: Record<string, unknown>) { return this.a.updateCountry(u, iso2, b); }

  @Roles("admin", "org_admin") @Get("users") @ApiOperation({ operationId: "admin_users_list" })
  users(@CurrentUser() u: AuthUser, @Query() q: UsersQuery) { return this.a.listUsers(u, q); }

  @Roles("admin", "org_admin") @Post("users") @ApiOperation({ operationId: "admin_users_create" })
  createUser(@CurrentUser() u: AuthUser, @Body() d: AdminUserCreateDto) { return this.a.createUser(u, d); }

  @Roles("admin", "org_admin") @Patch("users/:id") @ApiOperation({ operationId: "admin_users_update" })
  updateUser(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() d: AdminUserUpdateDto) { return this.a.updateUser(u, id, d); }

  @Roles("admin", "org_admin") @Post("broadcasts") @HttpCode(202) @ApiOperation({ operationId: "admin_broadcast" })
  broadcast(@CurrentUser() u: AuthUser, @Body() d: BroadcastDto) { return this.a.broadcast(u, d); }

  @Roles("agronomist", "admin") @Post("knowledge/:table/:id/review") @HttpCode(200) @ApiOperation({ operationId: "admin_knowledge_review" })
  review(@CurrentUser() u: AuthUser, @Param("table") t: string, @Param("id", ParseUUIDPipe) id: string, @Body() b: ReviewDto) { return this.a.review(u, t, id, b); }

  @Get("knowledge/:table/:id/revisions") @ApiOperation({ operationId: "admin_knowledge_revisions" })
  revisions(@CurrentUser() u: AuthUser, @Param("table") t: string, @Param("id", ParseUUIDPipe) id: string) { return this.a.revisions(u, t, id); }

  @Roles("admin") @Get("models") @ApiOperation({ operationId: "admin_models" })
  models() { return this.a.models(); }

  @Roles("admin") @Get("audit-log") @ApiOperation({ operationId: "admin_audit_log" })
  audit(@Query() q: AuditQuery) { return this.a.auditLog(q); }

  @Roles("admin", "org_admin") @Get("moderation") @ApiOperation({ operationId: "admin_moderation_queue" })
  queue(@Query() q: ModQuery) { return this.a.moderationQueue(q); }

  @Roles("admin", "org_admin") @Post("moderation/:id/decision") @HttpCode(204) @ApiOperation({ operationId: "admin_moderation_decide" })
  async decide(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() d: ModDecisionDto) { await this.a.decide(u, id, d); }
}

@Module({ imports: [AuthModule, GeoModule], controllers: [AdminController, KycReviewController, AdminStatsController], providers: [AdminService, KycReviewService, AdminStatsService, FieldCipher] })
export class AdminModule {}
