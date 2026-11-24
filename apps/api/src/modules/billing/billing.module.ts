import {
  Body, CanActivate, Controller, ExecutionContext, Get, Global, HttpCode, Injectable, Logger, Module, Param, Post, Query, Req, SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsUrl, IsUUID, Matches } from "class-validator";
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import { AuthUser, CurrentUser, Public } from "../../common/auth/auth.common";
import { AuditService } from "../../common/audit/audit.service";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { claimWebhookEvent, markWebhookProcessed, RawRequest, verifyWebhook } from "../../common/http/webhooks";
import { Cache } from "../../common/redis/redis.module";
import { upperIso } from "../geo/geo.dto";
import { Entitlements, entitlementsFor, effectivePlan, PlanCode, revenueCatStatus, SubscriptionLike } from "./entitlements.logic";

class CheckoutDto {
  @ApiProperty({ enum: ["premium", "organisation"] }) @IsIn(["premium", "organisation"]) plan: "premium" | "organisation";
  @ApiProperty({ enum: ["monthly", "yearly"] }) @IsIn(["monthly", "yearly"]) interval: "monthly" | "yearly";
  @ApiProperty({ enum: ["paystack", "flutterwave", "stripe"] }) @IsIn(["paystack", "flutterwave", "stripe"]) provider: "paystack" | "flutterwave" | "stripe";
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() organisationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ["https", "agriprice"], require_tld: false }) returnUrl?: string;
}
class CountryQ { @ApiPropertyOptional() @IsOptional() @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country?: string }

const FEATURE = "billing:feature";
/** Guard: @RequiresEntitlement("export_insights") or a numeric/array key checked by the handler. */
export const RequiresEntitlement = (key: keyof Entitlements) => SetMetadata(FEATURE, key);

@Injectable()
export class BillingService {
  private readonly log = new Logger(BillingService.name);
  constructor(private readonly sql: Sql, private readonly cache: Cache, private readonly audit: AuditService) {}

  private async subsFor(userId: string, orgId: string | null) {
    const rows = await this.sql.many<{ id: string; plan_code: PlanCode; status: string; current_period_end: Date | null; provider: string; cancel_at_period_end: boolean; organisation_id: string | null }>(
      `SELECT id, plan_code, status, current_period_end, provider, cancel_at_period_end, organisation_id FROM subscriptions
       WHERE user_id = $1 OR ($2::uuid IS NOT NULL AND organisation_id = $2) ORDER BY created_at DESC`, [userId, orgId]);
    return rows;
  }

  async status(user: Pick<AuthUser, "id" | "orgId">) {
    return this.cache.wrap(`billing:status:${user.id}`, 60, async () => {
      const rows = await this.subsFor(user.id, user.orgId);
      const subs: (SubscriptionLike & { row: (typeof rows)[number] })[] = rows.map((r) => ({ planCode: r.plan_code, status: r.status, currentPeriodEnd: r.current_period_end, row: r }));
      const plan = effectivePlan(subs);
      const winning = subs.find((s) => s.planCode === plan && plan !== "free");
      const override = await this.sql.one<{ entitlements: Partial<Entitlements> }>(`SELECT entitlements FROM plans WHERE code = $1`, [plan]);
      return {
        plan, source: !winning ? "none" : winning.row.organisation_id ? "organisation" : "personal",
        subscription: winning ? { id: winning.row.id, provider: winning.row.provider, status: winning.row.status,
          currentPeriodEnd: winning.row.current_period_end?.toISOString() ?? null, cancelAtPeriodEnd: winning.row.cancel_at_period_end } : null,
        entitlements: entitlementsFor(plan, override?.entitlements),
      };
    });
  }

  async entitlements(user: Pick<AuthUser, "id" | "orgId">): Promise<Entitlements> { return (await this.status(user)).entitlements; }
  invalidate(userId: string) { return this.cache.del(`billing:status:${userId}`); }

  async plans(country?: string) {
    const rows = await this.sql.many<{ code: PlanCode; name: Record<string, string>; prices: Record<string, unknown>; entitlements: Partial<Entitlements> }>(
      `SELECT code, name, prices, entitlements FROM plans WHERE active ORDER BY sort_order`);
    let currency: string | undefined;
    if (country) currency = (await this.sql.one<{ currency: string }>(`SELECT currency FROM countries WHERE iso2 = $1`, [country]))?.currency;
    return rows.map((p) => ({
      code: p.code, name: p.name, entitlements: entitlementsFor(p.code, p.entitlements),
      prices: currency && p.prices[currency] ? { [currency]: p.prices[currency] } : p.prices,
    }));
  }

  async checkout(user: AuthUser, d: CheckoutDto) {
    if (d.plan === "organisation") {
      if (!d.organisationId || d.organisationId !== user.orgId || user.role !== "org_admin") throw AppError.forbidden("org_admin_required", "Only an organisation admin can buy the Organisation plan");
    }
    const plan = await this.sql.one<{ prices: Record<string, Record<string, string>>; provider_ids: Record<string, Record<string, string> | string> }>(`SELECT prices, provider_ids FROM plans WHERE code = $1 AND active`, [d.plan]);
    if (!plan) throw AppError.notFound("plan");
    const u = await this.sql.one<{ email: string | null; currency: string }>(`SELECT u.email, c.currency FROM users u JOIN countries c ON c.iso2 = u.country_iso2 WHERE u.id = $1`, [user.id]);
    const currency = d.currency ?? u!.currency;
    const amount = plan.prices[currency]?.[d.interval];
    if (!amount) throw AppError.unprocessable("price_unavailable", `No ${d.interval} price in ${currency}`);
    const providerPlan = (plan.provider_ids[d.provider] as Record<string, string> | undefined)?.[`${d.interval}_${currency}`];
    if (!providerPlan) throw AppError.unprocessable("provider_plan_missing", `Plan isn't configured for ${d.provider} in ${currency}`);
    if (!u?.email && d.provider !== "flutterwave") throw AppError.unprocessable("email_required", "Add and verify an email address to subscribe on the web");
    const reference = `sub_${randomUUID()}`;
    const metadata = { userId: user.id, organisationId: d.organisationId ?? null, plan: d.plan, interval: d.interval };
    const env = process.env;
    let authorizationUrl: string;

    if (d.provider === "paystack") {
      // amount in pesewas/kobo; the plan code makes Paystack create the subscription after the first charge.
      const r = await psp("https://api.paystack.co/transaction/initialize", env.PAYSTACK_SECRET_KEY, {
        email: u!.email, amount: Math.round(Number(amount) * 100), currency, plan: providerPlan, reference, callback_url: d.returnUrl, metadata,
        channels: ["card", "mobile_money"],
      });
      authorizationUrl = r.data.authorization_url;
    } else if (d.provider === "flutterwave") {
      const r = await psp("https://api.flutterwave.com/v3/payments", env.FLUTTERWAVE_SECRET_KEY, {
        tx_ref: reference, amount, currency, payment_plan: providerPlan, redirect_url: d.returnUrl, meta: metadata,
        customer: { email: u?.email ?? `${user.id}@users.agriprice.app` }, payment_options: "card,mobilemoneyghana",
      });
      authorizationUrl = r.data.link;
    } else {
      const form = new URLSearchParams({
        mode: "subscription", "line_items[0][price]": providerPlan, "line_items[0][quantity]": "1", client_reference_id: reference,
        success_url: d.returnUrl ?? `${env.WEB_URL ?? "https://agriprice.app"}/billing/success`, cancel_url: d.returnUrl ?? `${env.WEB_URL ?? "https://agriprice.app"}/billing`,
        customer_email: u!.email!, "metadata[userId]": user.id, "metadata[plan]": d.plan, "subscription_data[metadata][userId]": user.id,
        "subscription_data[metadata][plan]": d.plan, ...(d.organisationId ? { "subscription_data[metadata][organisationId]": d.organisationId } : {}),
      });
      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST", headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(10_000),
      });
      const j = (await res.json()) as { url?: string; error?: { message: string } };
      if (!res.ok || !j.url) throw new AppError(502, "psp_error", "Bad gateway", j.error?.message ?? "Stripe error");
      authorizationUrl = j.url;
    }
    await this.audit.record({ actorId: user.id, action: "billing.checkout.started", data: { plan: d.plan, provider: d.provider, reference } });
    return { provider: d.provider, reference, authorizationUrl };
  }

  async cancel(user: AuthUser) {
    const s = (await this.status(user)).subscription;
    if (!s || s.provider === "revenuecat") throw AppError.unprocessable("manage_in_store", s ? "Manage app-store subscriptions in the App Store or Google Play" : "No active subscription");
    const row = await this.sql.one<{ provider_ref: string }>(`SELECT provider_ref FROM subscriptions WHERE id = $1`, [s.id]);
    const env = process.env;
    if (s.provider === "stripe") {
      await fetch(`https://api.stripe.com/v1/subscriptions/${row!.provider_ref}`, { method: "POST", headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "cancel_at_period_end=true" });
    } else if (s.provider === "paystack") {
      const sub = await fetch(`https://api.paystack.co/subscription/${row!.provider_ref}`, { headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` } }).then((r) => r.json()) as { data?: { email_token?: string } };
      await psp("https://api.paystack.co/subscription/disable", env.PAYSTACK_SECRET_KEY, { code: row!.provider_ref, token: sub.data?.email_token });
    } else if (s.provider === "flutterwave") {
      await fetch(`https://api.flutterwave.com/v3/subscriptions/${row!.provider_ref}/cancel`, { method: "PUT", headers: { Authorization: `Bearer ${env.FLUTTERWAVE_SECRET_KEY}` } });
    }
    await this.sql.exec(`UPDATE subscriptions SET cancel_at_period_end = true WHERE id = $1`, [s.id]);
    await this.invalidate(user.id);
    await this.audit.record({ actorId: user.id, action: "billing.subscription.cancelled", entity: "subscription", entityId: s.id });
    return this.status(user);
  }

  // ── webhooks ──
  async webhook(provider: string, req: RawRequest) {
    verifyWebhook(provider, req);
    const b = req.body as Record<string, any>;
    const eventId: string = provider === "revenuecat" ? b.event?.id : provider === "stripe" ? b.id : provider === "paystack" ? `${b.event}:${b.data?.id ?? b.data?.subscription_code ?? b.data?.reference}` : `${b.event}:${b.data?.id}`;
    if (!eventId || !(await claimWebhookEvent(this.sql, provider, eventId, "billing", b.event?.type ?? b.type ?? b.event ?? null, b))) return;
    try {
      const change = this.normalise(provider, b);
      if (change) await this.apply(provider, change);
      await markWebhookProcessed(this.sql, provider, eventId);
    } catch (e) {
      await markWebhookProcessed(this.sql, provider, eventId, (e as Error).message);
      throw e;
    }
  }

  private normalise(provider: string, b: Record<string, any>): { ref: string; userId?: string; email?: string; orgId?: string | null; plan?: PlanCode; status: string; periodEnd: Date | null; cancelAtEnd?: boolean } | null {
    if (provider === "revenuecat") {
      const e = b.event; const m = revenueCatStatus(e.type);
      if (m.event === "ignored") return null;
      const plan: PlanCode = String(e.entitlement_ids?.[0] ?? e.product_id ?? "").includes("org") ? "organisation" : "premium";
      return { ref: e.original_transaction_id ?? e.transaction_id, userId: e.app_user_id, plan, status: m.status, periodEnd: e.expiration_at_ms ? new Date(e.expiration_at_ms) : null, cancelAtEnd: e.type === "CANCELLATION" };
    }
    if (provider === "stripe") {
      if (!String(b.type).startsWith("customer.subscription.")) return null;
      const s = b.data.object;
      const status = ({ active: "active", trialing: "trialing", past_due: "past_due", canceled: "expired", unpaid: "past_due", incomplete_expired: "expired" } as Record<string, string>)[s.status] ?? "past_due";
      return { ref: s.id, userId: s.metadata?.userId, orgId: s.metadata?.organisationId ?? null, plan: s.metadata?.plan, status, periodEnd: new Date(s.current_period_end * 1000), cancelAtEnd: s.cancel_at_period_end };
    }
    if (provider === "paystack") {
      const d = b.data ?? {};
      const meta = d.metadata ?? d.authorization?.metadata ?? {};
      switch (b.event) {
        case "subscription.create": return { ref: d.subscription_code, email: d.customer?.email, userId: meta.userId, orgId: meta.organisationId, plan: meta.plan, status: "active", periodEnd: d.next_payment_date ? new Date(d.next_payment_date) : null };
        case "invoice.update": case "charge.success": return d.subscription?.subscription_code ? { ref: d.subscription.subscription_code, status: "active", periodEnd: d.subscription.next_payment_date ? new Date(d.subscription.next_payment_date) : null } : null;
        case "invoice.payment_failed": return { ref: d.subscription?.subscription_code, status: "past_due", periodEnd: null };
        case "subscription.not_renew": return { ref: d.subscription_code, status: "cancelled", periodEnd: d.next_payment_date ? new Date(d.next_payment_date) : null, cancelAtEnd: true };
        case "subscription.disable": return { ref: d.subscription_code, status: "expired", periodEnd: null };
        default: return null;
      }
    }
    if (provider === "flutterwave") {
      const d = b.data ?? {};
      if (b.event === "charge.completed" && d.status === "successful" && d.payment_plan) {
        const meta = b.meta_data ?? d.meta ?? {};
        const days = meta.interval === "yearly" ? 366 : 31;
        return { ref: String(d.payment_plan) + ":" + (d.customer?.id ?? meta.userId), userId: meta.userId, orgId: meta.organisationId, plan: meta.plan, status: "active", periodEnd: new Date(Date.now() + days * 86_400_000) };
      }
      if (b.event === "subscription.cancelled") return { ref: String(d.plan?.id ?? d.id) + ":" + d.customer?.id, status: "cancelled", periodEnd: null, cancelAtEnd: true };
      return null;
    }
    return null;
  }

  private async apply(provider: string, c: NonNullable<ReturnType<BillingService["normalise"]>>) {
    if (!c.ref) return;
    // Paystack's subscription.create doesn't echo checkout metadata: fall back to the customer's (verified) email.
    if (!c.userId && c.email) c.userId = (await this.sql.one<{ id: string }>(`SELECT id FROM users WHERE email = $1 AND email_verified_at IS NOT NULL`, [c.email]))?.id;
    if (!c.plan && provider === "paystack") c.plan = "premium";
    const existing = await this.sql.one<{ id: string; user_id: string | null }>(`SELECT id, user_id FROM subscriptions WHERE provider = $1 AND provider_ref = $2`, [provider, c.ref]);
    if (existing) {
      await this.sql.exec(
        `UPDATE subscriptions SET status = $2, current_period_end = coalesce($3, current_period_end), cancel_at_period_end = coalesce($4, cancel_at_period_end),
           plan_code = coalesce($5, plan_code) WHERE id = $1`, [existing.id, c.status, c.periodEnd, c.cancelAtEnd ?? null, c.plan ?? null]);
      if (existing.user_id) await this.invalidate(existing.user_id);
    } else {
      if (!c.userId || !c.plan || !(await this.sql.one(`SELECT 1 FROM users WHERE id = $1`, [c.userId]))) {
        this.log.warn({ provider, ref: c.ref }, "subscription webhook for unknown user/plan ignored");
        return;
      }
      await this.sql.exec(
        `INSERT INTO subscriptions (user_id, organisation_id, plan_code, provider, provider_ref, status, current_period_end, cancel_at_period_end)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (provider, provider_ref) DO NOTHING`,
        [c.plan === "organisation" ? null : c.userId, c.plan === "organisation" ? c.orgId : null, c.plan, provider, c.ref, c.status, c.periodEnd, c.cancelAtEnd ?? false]);
      await this.invalidate(c.userId);
    }
    await this.audit.record({ actorId: c.userId ?? existing?.user_id ?? null, action: `billing.subscription.${c.status}`, data: { provider, ref: c.ref } });
  }
}

async function psp(url: string, secret: string | undefined, body: unknown): Promise<any> {
  if (!secret) throw new AppError(503, "provider_unconfigured", "Service unavailable", "Payment provider is not configured");
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const j = (await res.json().catch(() => ({}))) as { status?: boolean | string; message?: string };
  if (!res.ok || j.status === false || j.status === "error") throw new AppError(502, "psp_error", "Bad gateway", j.message ?? `Provider returned ${res.status}`);
  return j;
}

@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly billing: BillingService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<keyof Entitlements | undefined>(FEATURE, [ctx.getHandler(), ctx.getClass()]);
    if (!key) return true;
    const user = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>().user;
    if (!user) throw AppError.unauthorized();
    const ent = await this.billing.entitlements(user);
    const v = ent[key];
    const ok = Array.isArray(v) ? v.length > 0 : typeof v === "number" ? v > 0 : Boolean(v);
    if (!ok) throw new AppError(402, "upgrade_required", "Payment required", `Your plan doesn't include ${key}`, { feature: key });
    return true;
  }
}

@ApiTags("billing")
@ApiBearerAuth()
@Controller("v1")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Public() @Get("billing/plans") @ApiOperation({ operationId: "billing_plans_list" })
  plans(@Query() q: CountryQ) { return this.billing.plans(q.country); }

  @Get("billing/subscription") @ApiOperation({ operationId: "billing_subscription_get" })
  status(@CurrentUser() u: AuthUser) { return this.billing.status(u); }

  @Post("billing/checkout") @HttpCode(200) @ApiOperation({ operationId: "billing_checkout" })
  checkout(@CurrentUser() u: AuthUser, @Body() d: CheckoutDto) { return this.billing.checkout(u, d); }

  @Post("billing/cancel") @HttpCode(200) @ApiOperation({ operationId: "billing_cancel" })
  cancel(@CurrentUser() u: AuthUser) { return this.billing.cancel(u); }

  @Public() @SkipThrottle() @Post("webhooks/billing/:provider") @HttpCode(204) @ApiOperation({ operationId: "billing_webhook" })
  async webhook(@Param("provider") provider: string, @Req() req: RawRequest) {
    if (!["revenuecat", "paystack", "flutterwave", "stripe"].includes(provider)) throw AppError.notFound("provider");
    await this.billing.webhook(provider, req);
  }
}

@Global()
@Module({ controllers: [BillingController], providers: [BillingService, EntitlementGuard], exports: [BillingService, EntitlementGuard] })
export class BillingModule {}
