import {
  Body, Controller, Delete, Get, Headers, HttpCode, Inject, Injectable, Logger, Module, OnApplicationBootstrap, OnModuleDestroy, Param, ParseUUIDPipe, Post, Query, Req, UploadedFile, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";
import { Worker } from "bullmq";
import type Redis from "ioredis";
import { AuthUser, CurrentUser, Public, Roles } from "../../common/auth/auth.common";
import { FieldCipher } from "../../common/crypto/crypto";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { cursor } from "../../common/http/request-context";
import type { RawRequest } from "../../common/http/webhooks";
import { QueueService } from "../../common/queue/queues";
import { REDIS } from "../../common/redis/redis.module";
import { StorageService } from "../../common/storage/storage.service";
import { PagedQuery } from "../geo/geo.dto";
import { ReviewDecisionDto } from "../prices/prices.dto";
import { MarketplaceModule } from "../marketplace/marketplace.module";
import { OrdersService } from "../marketplace/orders.service";
import { PaymentsService } from "./payments.service";

class PayDto {
  @IsIn(["paystack", "flutterwave", "hubtel"]) provider: string;
  @IsOptional() @IsIn(["momo", "card"]) method?: "momo" | "card";
  @IsOptional() @IsIn(["mtn", "telecel", "airteltigo"]) network?: "mtn" | "telecel" | "airteltigo";
  @IsOptional() @Matches(/^\+[1-9]\d{6,14}$/) msisdn?: string;
  @IsOptional() @IsUUID() paymentMethodId?: string;
  @IsOptional() @IsBoolean() saveMethod?: boolean;
}
class PayoutAccountDto {
  @IsIn(["momo", "bank"]) type: "momo" | "bank";
  @IsIn(["paystack", "flutterwave", "hubtel"]) provider: string;
  @IsOptional() @IsIn(["mtn", "telecel", "airteltigo"]) network?: "mtn" | "telecel" | "airteltigo";
  @IsOptional() @IsString() @MaxLength(20) bankCode?: string;
  @Matches(/^[0-9+]{6,30}$/) accountNumber: string;
  @IsString() @MaxLength(120) accountName: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
class PayoutDto { @Matches(/^\d{1,10}(\.\d{1,2})?$/) amount: string; @IsOptional() @IsUUID() accountId?: string }
class EvidenceDto { @IsOptional() @IsString() @MaxLength(2000) note?: string }
class DisputeDecisionDto {
  @IsIn(["release_seller", "refund_buyer", "split"]) outcome: "release_seller" | "refund_buyer" | "split";
  @IsOptional() @Matches(/^\d{1,10}(\.\d{1,2})?$/) refundAmount?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
class StatusPaged extends PagedQuery { @IsOptional() @IsString() @MaxLength(20) status?: string }
class ReconQuery { @IsOptional() @IsString() @MaxLength(20) provider?: string; @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) limit: number = 30 }

@ApiTags("payments")
@ApiBearerAuth()
@Controller("v1")
export class PaymentsController {
  constructor(private readonly p: PaymentsService) {}

  @Post("payments/orders/:id/pay") @HttpCode(200) @ApiOperation({ operationId: "payments_pay_order" })
  pay(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() d: PayDto, @Headers("idempotency-key") key?: string) { return this.p.pay(u, id, d, key); }

  @Get("payments/methods") @ApiOperation({ operationId: "payments_methods_list" })
  methods(@CurrentUser() u: AuthUser) { return this.p.methods(u); }

  @Delete("payments/methods/:id") @HttpCode(204) @ApiOperation({ operationId: "payments_methods_delete" })
  async delMethod(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { await this.p.deleteMethod(u, id); }

  @Public() @SkipThrottle() @Post("webhooks/payments/:provider") @HttpCode(200) @ApiOperation({ operationId: "payments_webhook" })
  webhook(@Param("provider") provider: string, @Req() req: RawRequest) {
    if (!["paystack", "flutterwave", "hubtel"].includes(provider)) throw AppError.notFound("provider");
    return this.p.webhook(provider, req);
  }

  @Get("wallet") @ApiOperation({ operationId: "wallet_get" })
  wallet(@CurrentUser() u: AuthUser) { return this.p.wallet(u); }

  @Get("wallet/ledger") @ApiOperation({ operationId: "wallet_ledger" })
  ledger(@CurrentUser() u: AuthUser, @Query() q: PagedQuery) { return this.p.ledgerEntries(u, q); }

  @Get("wallet/payout-accounts") @ApiOperation({ operationId: "wallet_payout_accounts_list" })
  accounts(@CurrentUser() u: AuthUser) { return this.p.payoutAccounts(u); }

  @Post("wallet/payout-accounts") @ApiOperation({ operationId: "wallet_payout_accounts_create" })
  addAccount(@CurrentUser() u: AuthUser, @Body() d: PayoutAccountDto) { return this.p.addPayoutAccount(u, d); }

  @Get("wallet/payouts") @ApiOperation({ operationId: "wallet_payouts_list" })
  payouts(@CurrentUser() u: AuthUser) { return this.p.payouts(u); }

  @Post("wallet/payouts") @ApiOperation({ operationId: "wallet_payouts_request" })
  requestPayout(@CurrentUser() u: AuthUser, @Body() d: PayoutDto, @Headers("idempotency-key") key?: string) { return this.p.requestPayout(u, d, key); }

  @Get("disputes/:id") @ApiOperation({ operationId: "disputes_get" })
  dispute(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { return this.p.dispute(u, id); }

  @Post("disputes/:id/evidence") @ApiOperation({ operationId: "disputes_evidence_upload" }) @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 15 * 1024 * 1024, files: 1 } }))
  evidence(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() d: EvidenceDto, @UploadedFile() f?: Express.Multer.File) { return this.p.addEvidence(u, id, f, d.note); }
}

@ApiTags("admin")
@ApiBearerAuth()
@Roles("admin")
@Controller("v1/admin")
export class AdminPaymentsController {
  constructor(private readonly p: PaymentsService, private readonly sql: Sql) {}

  @Get("disputes") @ApiOperation({ operationId: "admin_disputes_list" })
  async disputes(@Query() q: StatusPaged) {
    const c = cursor.decode<{ t: string; id: string }>(q.cursor);
    const rows = await this.sql.many<{ id: string; created_at: Date }>(
      `SELECT d.*, o.total, o.currency, o.buyer_id, o.seller_id FROM disputes d JOIN orders o ON o.id = d.order_id
       WHERE ($1::text IS NULL OR d.status = $1) AND ($2::timestamptz IS NULL OR (d.created_at, d.id) > ($2, $3::uuid)) ORDER BY d.created_at, d.id LIMIT $4`,
      [q.status ?? null, c?.t ?? null, c?.id ?? null, q.limit + 1]);
    const page = rows.slice(0, q.limit); const last = page[page.length - 1];
    return { data: page, nextCursor: rows.length > q.limit && last ? cursor.encode({ t: last.created_at.toISOString(), id: last.id }) : null };
  }

  @Post("disputes/:id/decision") @HttpCode(200) @ApiOperation({ operationId: "admin_dispute_decide" })
  decide(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() d: DisputeDecisionDto) {
    if (d.outcome === "split" && !d.refundAmount) throw AppError.unprocessable("refund_amount_required", "A split needs the refund amount");
    return this.p.decideDispute(u, id, d);
  }

  @Get("payouts") @ApiOperation({ operationId: "admin_payouts_list" })
  async payouts(@Query() q: StatusPaged) {
    const c = cursor.decode<{ t: string; id: string }>(q.cursor);
    const rows = await this.sql.many<{ id: string; created_at: Date }>(
      `SELECT p.*, a.label AS account_label FROM payouts p JOIN payout_accounts a ON a.id = p.account_id
       WHERE p.status = coalesce($1, 'pending_review') AND ($2::timestamptz IS NULL OR (p.created_at, p.id) > ($2, $3::uuid)) ORDER BY p.created_at, p.id LIMIT $4`,
      [q.status ?? null, c?.t ?? null, c?.id ?? null, q.limit + 1]);
    const page = rows.slice(0, q.limit); const last = page[page.length - 1];
    return { data: page, nextCursor: rows.length > q.limit && last ? cursor.encode({ t: last.created_at.toISOString(), id: last.id }) : null };
  }

  @Post("payouts/:id/review") @HttpCode(200) @ApiOperation({ operationId: "admin_payout_review" })
  review(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() d: ReviewDecisionDto) { return this.p.reviewPayout(u, id, d); }

  @Get("reconciliation") @ApiOperation({ operationId: "admin_reconciliation" })
  recon(@Query() q: ReconQuery) {
    return this.sql.many(`SELECT * FROM reconciliation_runs WHERE ($1::text IS NULL OR provider = $1) ORDER BY day DESC LIMIT $2`, [q.provider ?? null, q.limit]);
  }
}

/**
 * Commerce scheduler. Runs inside the API image (same services, same ledger code) as a separate
 * deployment with RUN_SCHEDULERS=true, so web pods stay stateless.
 */
@Injectable()
export class CommerceScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger("commerce-scheduler");
  private worker?: Worker;
  constructor(
    private readonly payments: PaymentsService, private readonly orders: OrdersService, private readonly queue: QueueService, private readonly sql: Sql,
    private readonly cipher: FieldCipher, private readonly storage: StorageService, @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationBootstrap() {
    if (process.env.RUN_SCHEDULERS !== "true") return;
    const q = this.queue.queue("commerce");
    await q.upsertJobScheduler("order-timeouts", { every: 60_000 }, { name: "order-timeouts" });
    await q.upsertJobScheduler("reconcile-daily", { pattern: "30 2 * * *" }, { name: "reconcile" });
    this.worker = new Worker("commerce", async (job) => {
      switch (job.name) {
        case "order-timeouts": return this.orders.sweepTimeouts();
        case "refund-execute": return this.payments.executeRefund(job.data);
        case "payout-execute": return this.payments.executePayout(job.data.payoutId);
        case "kyc-submit": return this.kyc(job.data);
        case "reconcile": {
          const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
          for (const p of ["paystack", "flutterwave", "hubtel"]) await this.payments.reconcile(p, day);
          return;
        }
      }
    }, { connection: this.redis.duplicate(), concurrency: 4 });
    this.worker.on("failed", (j, e) => this.log.error({ job: j?.name, id: j?.id, err: e.message }, "commerce job failed"));
    this.log.log("commerce scheduler running");
  }

  /**
   * Optional automated check by a KYC provider (e.g. Smile ID / Youverify) configured via KYC_PROVIDER_URL; results return by
   * webhook. Without a provider, applications wait in the admin console's seller approvals queue instead.
   */
  private async kyc(j: { userId: string; reference: string; country: string }) {
    const url = process.env.KYC_PROVIDER_URL;
    if (!url) return;
    const s = await this.sql.one<{ kyc_id_type: string; kyc_id_number_enc: string; kyc_id_photo_key: string; kyc_selfie_key: string }>(
      `SELECT kyc_id_type, kyc_id_number_enc, kyc_id_photo_key, kyc_selfie_key FROM seller_profiles WHERE user_id = $1 AND kyc_provider_ref = $2 AND kyc_status = 'pending'`,
      [j.userId, j.reference]);
    if (!s) return; // withdrawn, already decided or resubmitted
    const bucket = this.storage.cfg.s3.reportsBucket;
    const res = await fetch(url, {
      method: "POST", headers: { Authorization: `Bearer ${process.env.KYC_PROVIDER_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ reference: j.reference, country: j.country, id_type: s.kyc_id_type, id_number: this.cipher.decrypt(s.kyc_id_number_enc),
        id_photo_url: await this.storage.signedGetUrl(bucket, s.kyc_id_photo_key, 900), selfie_url: await this.storage.signedGetUrl(bucket, s.kyc_selfie_key, 900),
        callback_url: `${process.env.API_PUBLIC_URL}/v1/webhooks/kyc?token=${process.env.WEBHOOK_SHARED_SECRET}` }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`kyc provider ${res.status}`);
  }

  async onModuleDestroy() { await this.worker?.close(); }
}

@Module({
  imports: [MarketplaceModule],
  controllers: [PaymentsController, AdminPaymentsController],
  providers: [PaymentsService, CommerceScheduler, FieldCipher],
  exports: [PaymentsService],
})
export class PaymentsModule {}
