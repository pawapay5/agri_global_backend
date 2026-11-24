import { Global, Injectable, Module } from "@nestjs/common";
import type { PoolClient } from "pg";
import { Sql } from "../../common/db/database.module";
import { assertBalanced, NORMAL, Posting } from "./ledger.logic";

export interface PostRefs { orderId?: string | null; paymentId?: string | null; payoutId?: string | null; memo?: string }

/**
 * Writes balanced transactions. `reference` makes every posting idempotent: replaying a webhook
 * or a timeout job can never double-post. The DB also enforces balance (deferred constraint trigger)
 * and immutability (no UPDATE/DELETE on entries).
 */
@Injectable()
export class LedgerService {
  constructor(private readonly sql: Sql) {}

  async post(kind: string, reference: string, postings: Posting[], refs: PostRefs = {}, client?: PoolClient): Promise<{ id: string; created: boolean }> {
    if (!postings.length) return { id: "", created: false };
    assertBalanced(postings);
    const run = async (c: PoolClient) => {
      const tx = await c.query<{ id: string }>(
        `INSERT INTO ledger_transactions (kind, reference, order_id, payment_id, payout_id, memo) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (reference) DO NOTHING RETURNING id`, [kind, reference, refs.orderId ?? null, refs.paymentId ?? null, refs.payoutId ?? null, refs.memo ?? null]);
      if (!tx.rows[0]) {
        const existing = await c.query<{ id: string }>(`SELECT id FROM ledger_transactions WHERE reference = $1`, [reference]);
        return { id: existing.rows[0]!.id, created: false };
      }
      for (const p of postings) {
        const currency = p.account.split(":").pop()!;
        const ownerId = p.kind === "seller" || p.kind === "buyer" ? p.account.split(":")[1] : null;
        const acc = await c.query<{ id: string }>(
          `INSERT INTO ledger_accounts (code, kind, normal, currency, owner_id) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`, [p.account, p.kind, NORMAL[p.kind], currency, ownerId]);
        await c.query(`INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, currency) VALUES ($1,$2,$3,$4,$5)`,
          [tx.rows[0].id, acc.rows[0]!.id, p.direction, p.amount, currency]);
      }
      return { id: tx.rows[0].id, created: true };
    };
    return client ? run(client) : this.sql.tx(run);
  }

  async balance(code: string): Promise<string> {
    const r = await this.sql.one<{ balance: string }>(`SELECT balance::text FROM ledger_balances WHERE code = $1`, [code]);
    return r?.balance ?? "0.00";
  }
}

@Global()
@Module({ providers: [LedgerService], exports: [LedgerService] })
export class LedgerModule {}
