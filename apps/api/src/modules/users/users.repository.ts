import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DRIZZLE, Db, Sql } from "../../common/db/database.module";
import { oauthIdentities, UserRow, users } from "../../common/db/schema";
import { AppError } from "../../common/http/problem";

export function toUserDto(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    phone: u.phone,
    emailVerified: Boolean(u.emailVerifiedAt),
    phoneVerified: Boolean(u.phoneVerifiedAt),
    fullName: u.fullName,
    avatarUrl: u.avatarUrl,
    role: u.role,
    country: u.countryIso2,
    organisationId: u.organisationId,
    totpEnabled: Boolean(u.totpEnabledAt),
    deletionScheduledAt: u.deletionScheduledAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

@Injectable()
export class UsersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db, private readonly sql: Sql) {}

  byId(id: string) { return this.db.query.users.findFirst({ where: eq(users.id, id) }); }
  byEmail(email: string) { return this.db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) }); }
  byPhone(phone: string) { return this.db.query.users.findFirst({ where: eq(users.phone, phone) }); }

  async mustGet(id: string): Promise<UserRow> {
    const u = await this.byId(id);
    if (!u) throw AppError.notFound("user");
    return u;
  }

  async create(values: typeof users.$inferInsert): Promise<UserRow> {
    await this.assertCountry(values.countryIso2);
    try {
      const [u] = await this.db.insert(users).values(values).returning();
      return u!;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw AppError.conflict("account_exists", "An account with these details already exists");
      throw e;
    }
  }

  async update(id: string, values: Partial<typeof users.$inferInsert>): Promise<UserRow> {
    const [u] = await this.db.update(users).set(values).where(eq(users.id, id)).returning();
    if (!u) throw AppError.notFound("user");
    return u;
  }

  async byOAuth(provider: string, subject: string) {
    const r = await this.sql.one<{ user_id: string }>(`SELECT user_id FROM oauth_identities WHERE provider = $1 AND subject = $2`, [provider, subject]);
    return r ? this.byId(r.user_id) : undefined;
  }

  async linkOAuth(userId: string, provider: string, subject: string, email: string | null) {
    await this.db.insert(oauthIdentities).values({ userId, provider, subject, email }).onConflictDoNothing();
  }

  async assertCountry(iso2: string) {
    const c = await this.sql.one(`SELECT 1 FROM countries WHERE iso2 = $1`, [iso2]);
    if (!c) throw AppError.unprocessable("country_unsupported", `Country ${iso2} is not available`);
  }

  /** Map an E.164 number to a country via country-pack phone prefixes (longest match). */
  async countryForPhone(phone: string): Promise<string | null> {
    const r = await this.sql.one<{ iso2: string }>(
      `SELECT iso2 FROM countries WHERE phone_prefix IS NOT NULL AND $1 LIKE phone_prefix || '%' ORDER BY length(phone_prefix) DESC LIMIT 1`, [phone]);
    return r?.iso2 ?? null;
  }
}
