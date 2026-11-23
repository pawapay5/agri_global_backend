import { Global, Inject, Injectable, Module, OnModuleDestroy } from "@nestjs/common";
import { JobsOptions, Queue } from "bullmq";
import Redis from "ioredis";
import { REDIS } from "../redis/redis.module";

/**
 * Queue names and job payloads shared with apps/workers.
 * Keep in sync with apps/workers/src/queues.ts (both import the same literal names).
 */
export const QUEUES = {
  notifications: "notifications",
  alerts: "alerts",
  prices: "prices",
  accounts: "accounts",
} as const;

export interface DispatchNotificationJob {
  userId: string;
  category: "price_alert" | "market_update" | "weather" | "system" | "weekly_insight";
  templateKey: string;
  params: Record<string, string | number>;
  data?: Record<string, unknown>;
  /** Channels to try; in_app is always written. Empty = use the user's category preferences. */
  channels?: Array<"push" | "email" | "sms" | "whatsapp" | "in_app">;
  dedupeKey?: string;
}
export interface SendOtpJob { channel: "sms" | "email"; destination: string; code: string; purpose: string; locale: string }
export interface EvaluateSeriesJob { commodityId: string; marketId: string; priceType: string; bucket: string }
export interface RefreshAggregatesJob { from: string; to: string }

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly queues = new Map<string, Queue>();
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private q(name: string) {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.redis.duplicate(), defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 } });
      this.queues.set(name, q);
    }
    return q;
  }

  sendOtp(job: SendOtpJob) {
    // OTPs are time-critical: fewer retries, no dedupe beyond the OTP cooldown.
    return this.q(QUEUES.notifications).add("send-otp", job, { attempts: 3, backoff: { type: "fixed", delay: 1500 } });
  }
  dispatch(job: DispatchNotificationJob, opts?: JobsOptions) {
    return this.q(QUEUES.notifications).add("dispatch", job, { ...opts, jobId: job.dedupeKey ? `dispatch:${job.dedupeKey}` : undefined });
  }
  evaluateSeries(job: EvaluateSeriesJob) {
    const id = `eval:${job.commodityId}:${job.marketId}:${job.priceType}:${job.bucket}`;
    return this.q(QUEUES.alerts).add("evaluate-series", job, { jobId: id.replace(/:/g, "_") });
  }
  refreshAggregates(job: RefreshAggregatesJob) {
    return this.q(QUEUES.prices).add("refresh-aggregates", job);
  }
  async onModuleDestroy() { await Promise.all([...this.queues.values()].map((q) => q.close())); }
}

@Global()
@Module({ providers: [QueueService], exports: [QueueService] })
export class QueueModule {}
