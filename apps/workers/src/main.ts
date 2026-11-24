import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { Pool } from "pg";
import pino from "pino";
import { purgeDeletedAccounts, snapshotSupply } from "./jobs/accounts";
import { AlertEvaluator, EvaluateSeriesJob, refreshAggregates, sweepNewAggregates } from "./jobs/alerts";
import { DeliverJob, Dispatcher, DispatchJob, SendOtpJob } from "./jobs/dispatch";
import { ReportGenerator } from "./jobs/reports";
import { revalidateWeb } from "./jobs/revalidate";
import { buildProviders, PermanentError } from "./providers/providers";

// Queue names are shared with apps/api/src/common/queue/queues.ts.
const Q = { notifications: "notifications", deliveries: "deliveries", alerts: "alerts", prices: "prices", accounts: "accounts", reports: "reports" } as const;

const log = pino({ name: "agriprice-workers", level: process.env.LOG_LEVEL ?? "info", redact: ["*.code", "*.destination", "*.to"] });
const revalidate = { url: process.env.WEB_REVALIDATE_URL, secret: process.env.REVALIDATE_SECRET };
const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
// Log a Redis outage once (and recovery once) instead of an "Unhandled error event" per retry.
let redisDown = false;
connection.on("error", (err: Error & { code?: string }) => {
  if (!redisDown) log.error({ code: err.code ?? err.message }, "cannot reach Redis; is it running? retrying in the background");
  redisDown = true;
});
connection.on("ready", () => { if (redisDown) log.info("reconnected to Redis"); redisDown = false; });
const db = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://agriprice:agriprice@localhost:5432/agriprice", max: 10, application_name: "agriprice-workers" });

const defaults = { attempts: 6, backoff: { type: "exponential" as const, delay: 5_000 }, removeOnComplete: 1000, removeOnFail: 5000 };
const queues = Object.fromEntries(Object.values(Q).map((n) => [n, new Queue(n, { connection, defaultJobOptions: defaults })])) as Record<(typeof Q)[keyof typeof Q], Queue>;

const dispatcher = new Dispatcher(db, buildProviders(log), queues.deliveries, log);
const evaluator = new AlertEvaluator(db, queues.notifications, log);
const reports = new ReportGenerator(db, queues.notifications, log);

const workers = [
  new Worker(Q.notifications, async (job) => {
    if (job.name === "send-otp") return dispatcher.sendOtp(job.data as SendOtpJob);
    if (job.name === "dispatch") return dispatcher.dispatch(job.data as DispatchJob);
    if (job.name === "send-sms") return dispatcher.sendSms(job.data as { to: string; body: string });
  }, { connection, concurrency: 20 }),

  new Worker(Q.reports, async (job) => {
    if (job.name === "generate") return reports.generate((job.data as { reportId: string }).reportId);
  }, { connection, concurrency: 2 }),

  new Worker(Q.deliveries, async (job) => {
    try { await dispatcher.deliver(job.data as DeliverJob, job.attemptsMade); }
    catch (e) { if (e instanceof PermanentError) { log.warn({ err: e.message }, "delivery dropped"); return; } throw e; }
  }, { connection, concurrency: 20, limiter: { max: 50, duration: 1000 } }),

  new Worker(Q.alerts, async (job) => {
    if (job.name === "evaluate-series") return evaluator.evaluate(job.data as EvaluateSeriesJob);
    if (job.name === "sweep") return revalidateWeb(await sweepNewAggregates(db, queues.alerts, log), revalidate, log);
  }, { connection, concurrency: 5 }),

  new Worker(Q.prices, async (job) => {
    if (job.name === "refresh-aggregates") {
      const { from, to } = job.data as { from: string; to: string };
      await refreshAggregates(db, from, to);
      // Re-evaluate alerts for the backfilled range.
      await revalidateWeb(await sweepNewAggregates(db, queues.alerts, log), revalidate, log);
    }
  }, { connection, concurrency: 1 }),

  new Worker(Q.accounts, async (job) => {
    if (job.name === "purge-deleted") return purgeDeletedAccounts(db, log);
    if (job.name === "supply-snapshot") return snapshotSupply(db, log);
  }, { connection, concurrency: 1 }),
];

for (const w of workers) {
  w.on("failed", (job, err) => log.error({ queue: w.name, job: job?.name, id: job?.id, attempts: job?.attemptsMade, err: err.message }, "job failed"));
}

async function schedule() {
  // Repeatable jobs (upserted, so restarts don't duplicate them).
  await queues.alerts.upsertJobScheduler("alerts-sweep", { every: 5 * 60_000 }, { name: "sweep" });
  await queues.accounts.upsertJobScheduler("accounts-purge", { pattern: "15 3 * * *" }, { name: "purge-deleted" });
  await queues.accounts.upsertJobScheduler("supply-snapshot", { pattern: "45 23 * * *" }, { name: "supply-snapshot" });
}

void schedule().then(() => log.info("workers started"));

async function shutdown() {
  log.info("shutting down");
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all(Object.values(queues).map((q) => q.close()));
  await db.end();
  connection.disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
