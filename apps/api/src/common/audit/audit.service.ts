import { Global, Injectable, Logger, Module } from "@nestjs/common";
import { Sql } from "../db/database.module";
import type { ClientMeta } from "../http/request-context";

export interface AuditEntry {
  actorId: string | null;
  action: string;                // e.g. auth.login.succeeded, price.review.approved
  entity?: string;
  entityId?: string;
  data?: Record<string, unknown>; // never put secrets, OTPs or tokens here
}

@Injectable()
export class AuditService {
  private readonly log = new Logger("audit");
  constructor(private readonly sql: Sql) {}

  /** Best-effort write; auditing never breaks the user flow, but failures are logged loudly. */
  async record(e: AuditEntry, client?: Partial<ClientMeta>): Promise<void> {
    try {
      await this.sql.exec(
        `INSERT INTO audit_log (actor_id, action, entity, entity_id, ip, user_agent, request_id, data)
         VALUES ($1, $2, $3, $4, $5::inet, $6, $7, $8)`,
        [e.actorId, e.action, e.entity ?? null, e.entityId ?? null, client?.ip ?? null, client?.userAgent ?? null, client?.requestId ?? null, e.data ?? {}],
      );
    } catch (err) {
      this.log.error({ err, action: e.action }, "audit write failed");
    }
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
