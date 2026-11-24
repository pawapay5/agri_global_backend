import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { APP_CONFIG, AppConfig } from "../../config/config";

export const REDIS = Symbol("REDIS");

const log = new Logger("Redis");

/**
 * Logs connection loss once per outage (and recovery once), instead of ioredis's "Unhandled error event"
 * on every retry. `.duplicate()` clients (BullMQ queues/workers, socket.io adapter) don't inherit listeners,
 * so they're wrapped too and share one status: an outage prints one line, not one per connection.
 * ioredis keeps reconnecting in the background either way.
 */
export function withConnectionLogging(client: Redis, url: string, shared = { down: new Set<Redis>() }): Redis {
  const target = url.replace(/\/\/[^@]*@/, "//***@");
  client.on("error", (err: Error & { code?: string }) => {
    if (shared.down.size === 0) log.error(`Cannot reach Redis at ${target} (${err.code ?? err.message}). Is it running? Retrying in the background.`);
    shared.down.add(client);
  });
  client.on("ready", () => {
    if (!shared.down.delete(client)) return;
    if (shared.down.size === 0) log.log(`Reconnected to Redis at ${target}`);
  });
  client.on("end", () => { shared.down.delete(client); });
  const duplicate = client.duplicate.bind(client);
  client.duplicate = ((...args: Parameters<Redis["duplicate"]>) => withConnectionLogging(duplicate(...args), url, shared)) as Redis["duplicate"];
  return client;
}

@Injectable()
export class RedisLifecycle implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  async onModuleDestroy() { await this.redis.quit().catch(() => undefined); }
}

/** JSON cache helper with stampede-safe-enough TTL semantics for read endpoints. */
@Injectable()
export class Cache {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async wrap<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const hit = await this.redis.get(key).catch(() => null);
    if (hit) return JSON.parse(hit) as T;
    const value = await fn();
    await this.redis.set(key, JSON.stringify(value), "EX", ttlSeconds).catch(() => undefined);
    return value;
  }
  async del(...keys: string[]) { if (keys.length) await this.redis.del(...keys); }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) =>
        withConnectionLogging(new Redis(cfg.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false }), cfg.redisUrl),
    },
    RedisLifecycle,
    Cache,
  ],
  exports: [REDIS, Cache],
})
export class RedisModule {}
