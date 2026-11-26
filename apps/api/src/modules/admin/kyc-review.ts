import { Body, Controller, Get, HttpCode, Injectable, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, Length, ValidateIf } from "class-validator";
import { AuthUser, CurrentUser, Roles } from "../../common/auth/auth.common";
import { AuditService } from "../../common/audit/audit.service";
import { FieldCipher } from "../../common/crypto/crypto";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { cursor } from "../../common/http/request-context";
import { QueueService } from "../../common/queue/queues";
import { StorageService } from "../../common/storage/storage.service";
import { PagedQuery } from "../geo/geo.dto";

/** Document links expire quickly: long enough to look, too short to be worth sharing. */
export const KYC_LINK_SECONDS = 300;

export class KycQuery extends PagedQuery { @IsOptional() @IsIn(["pending", "verified", "rejected"]) status?: "pending" | "verified" | "rejected" }
export class KycDecisionDto {
  @IsIn(["approve", "reject"]) decision: "approve" | "reject";
  @ValidateIf((d: KycDecisionDto) => d.decision === "reject") @IsString() @Length(5, 500) reason?: string;
}

/** Shows only the last four characters of an ID number, so a glance at the queue doesn't expose it. */
export const maskId = (n: string) => (n.length <= 4 ? "•".repeat(n.length) : `${"•".repeat(Math.min(n.length - 4, 8))}${n.slice(-4)}`);

interface KycRow {
  user_id: string; display_name: string; country_iso2: string; kyc_status: string; kyc_id_type: string | null; kyc_id_number_enc: string | null;
  kyc_id_photo_key: string | null; kyc_selfie_key: string | null; kyc_submitted_at: Date | null; kyc_reviewed_at: Date | null; kyc_rejection_reason: string | null;
  full_name: string | null; email: string | null; phone: string | null; reviewer_name: string | null;
}

@Injectable()
export class KycReviewService {
  constructor(private readonly sql: Sql, private readonly cipher: FieldCipher, private readonly storage: StorageService,
    private readonly audit: AuditService, private readonly queue: QueueService) {}

  /** An org admin reviews applicants from their own country only. */
  private scope(actor: AuthUser) { return actor.role === "admin" ? null : actor.country; }

  async list(actor: AuthUser, q: KycQuery) {
    const status = q.status ?? "pending";
    const c = q.cursor ? cursor.decode<{ t: string; id: string }>(q.cursor) : null;
    // Oldest first while waiting (fair queue); newest first once decided.
    const asc = status === "pending";
    const sortCol = asc ? "sp.kyc_submitted_at" : "sp.kyc_reviewed_at";
    const rows = await this.sql.many<KycRow>(
      `SELECT sp.user_id, sp.display_name, sp.country_iso2, sp.kyc_status, sp.kyc_id_type, sp.kyc_id_number_enc, sp.kyc_id_photo_key, sp.kyc_selfie_key,
              sp.kyc_submitted_at, sp.kyc_reviewed_at, sp.kyc_rejection_reason, u.full_name, u.email, u.phone, r.full_name AS reviewer_name
       FROM seller_profiles sp JOIN users u ON u.id = sp.user_id LEFT JOIN users r ON r.id = sp.kyc_reviewed_by
       WHERE sp.kyc_status = $1 AND ($2::char(2) IS NULL OR sp.country_iso2 = $2)
         AND ($3::timestamptz IS NULL OR (coalesce(${sortCol}, 'epoch'), sp.user_id) ${asc ? ">" : "<"} ($3, $4::uuid))
       ORDER BY coalesce(${sortCol}, 'epoch') ${asc ? "ASC" : "DESC"}, sp.user_id ${asc ? "ASC" : "DESC"} LIMIT $5`,
      [status, this.scope(actor), c?.t ?? null, c?.id ?? null, q.limit + 1]);
    const page = rows.slice(0, q.limit);
    const data = await Promise.all(page.map((r) => this.dto(r)));
    if (page.length) await this.audit.record({ actorId: actor.id, action: "admin.kyc.view", data: { status, userIds: page.map((r) => r.user_id) } });
    const last = page.at(-1);
    const lastAt = last ? (asc ? last.kyc_submitted_at : last.kyc_reviewed_at) ?? new Date(0) : null;
    return { data, nextCursor: rows.length > q.limit && last && lastAt ? cursor.encode({ t: lastAt.toISOString(), id: last.user_id }) : null };
  }

  private async dto(r: KycRow) {
    const bucket = this.storage.cfg.s3.reportsBucket;
    const link = (k: string | null) => (k ? this.storage.signedGetUrl(bucket, k, KYC_LINK_SECONDS) : Promise.resolve(null));
    let idNumber: string | null = null;
    try { idNumber = r.kyc_id_number_enc ? this.cipher.decrypt(r.kyc_id_number_enc) : null; } catch { idNumber = null; }
    return {
      userId: r.user_id, displayName: r.display_name, fullName: r.full_name, email: r.email, phone: r.phone, country: r.country_iso2, status: r.kyc_status,
      idType: r.kyc_id_type, idNumber, idNumberMasked: idNumber ? maskId(idNumber) : null,
      idPhotoUrl: await link(r.kyc_id_photo_key), selfieUrl: await link(r.kyc_selfie_key), linksExpireInSeconds: KYC_LINK_SECONDS,
      submittedAt: r.kyc_submitted_at?.toISOString() ?? null, reviewedAt: r.kyc_reviewed_at?.toISOString() ?? null, reviewedBy: r.reviewer_name,
      rejectionReason: r.kyc_rejection_reason,
    };
  }

  async decide(actor: AuthUser, userId: string, d: KycDecisionDto) {
    if (userId === actor.id) throw AppError.forbidden("own_application", "Someone else has to review your own application");
    const approve = d.decision === "approve";
    const reason = approve ? null : (d.reason ?? "").trim();
    if (!approve && (!reason || reason.length < 5)) throw AppError.unprocessable("reason_required", "Tell the applicant why, so they can fix it");
    const r = await this.sql.one<{ user_id: string }>(
      `UPDATE seller_profiles SET kyc_status = $2, verified_at = CASE WHEN $2 = 'verified' THEN now() ELSE NULL END, kyc_reviewed_by = $3, kyc_reviewed_at = now(),
         kyc_rejection_reason = $4
       WHERE user_id = $1 AND kyc_status = 'pending' AND ($5::char(2) IS NULL OR country_iso2 = $5) RETURNING user_id`,
      [userId, approve ? "verified" : "rejected", actor.id, reason, this.scope(actor)]);
    if (!r) throw AppError.notFound("kyc_application", "This application isn't waiting for review (someone may have decided it already)");
    await this.queue.dispatch({
      userId, category: "system", templateKey: approve ? "seller.kyc_approved" : "seller.kyc_rejected",
      params: approve
        ? { title: "You're approved to sell", body: "Your seller application was approved. You can now publish listings." }
        : { title: "Your seller application needs changes", body: `Your seller application wasn't approved: ${reason} You can fix this and apply again.` },
      data: { link: "/app/sell" }, dedupeKey: `kyc:${userId}:${Date.now()}`,
    });
    await this.audit.record({ actorId: actor.id, action: approve ? "admin.kyc.approve" : "admin.kyc.reject", entity: "user", entityId: userId, data: reason ? { reason } : {} });
  }
}

@ApiTags("admin")
@ApiBearerAuth()
@Roles("admin", "org_admin")
@Controller("v1/admin/kyc")
export class KycReviewController {
  constructor(private readonly k: KycReviewService) {}

  @Get() @ApiOperation({ operationId: "admin_kyc_list" })
  list(@CurrentUser() u: AuthUser, @Query() q: KycQuery) { return this.k.list(u, q); }

  @Post(":userId/decision") @HttpCode(204) @ApiOperation({ operationId: "admin_kyc_decide" })
  async decide(@CurrentUser() u: AuthUser, @Param("userId", ParseUUIDPipe) id: string, @Body() d: KycDecisionDto) { await this.k.decide(u, id, d); }
}
