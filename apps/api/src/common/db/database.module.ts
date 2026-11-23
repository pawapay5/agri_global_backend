import { Global, Inject, Injectable, Module, OnModuleDestroy } from "@nestjs/common";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, PoolClient, QueryResultRow, types } from "pg";
import { APP_CONFIG, AppConfig } from "../../config/config";
import * as schema from "./schema";

// Keep NUMERIC as string (exact decimals); BIGINT counts as number (safe for our ranges).
types.setTypeParser(types.builtins.INT8, (v) => Number(v));

export type Db = NodePgDatabase<typeof schema>;
export const PG_POOL = Symbol("PG_POOL");
export const DRIZZLE = Symbol("DRIZZLE");

/** Thin raw-SQL helper for hypertables, continuous aggregates and PostGIS queries. */
@Injectable()
export class Sql implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async many<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
    return (await this.pool.query<T>(text, values)).rows;
  }
  async one<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T | undefined> {
    return (await this.pool.query<T>(text, values)).rows[0];
  }
  async exec(text: string, values: unknown[] = []): Promise<number> {
    return (await this.pool.query(text, values)).rowCount ?? 0;
  }
  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const out = await fn(c);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async ping(): Promise<boolean> {
    try { await this.pool.query("SELECT 1"); return true; } catch { return false; }
  }
  async onModuleDestroy() { await this.pool.end(); }
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) =>
        new Pool({ connectionString: cfg.databaseUrl, max: 20, idleTimeoutMillis: 30_000, statement_timeout: 15_000, application_name: "agriprice-api" }),
    },
    { provide: DRIZZLE, inject: [PG_POOL], useFactory: (pool: Pool): Db => drizzle(pool, { schema }) },
    Sql,
  ],
  exports: [PG_POOL, DRIZZLE, Sql],
})
export class DatabaseModule {}
