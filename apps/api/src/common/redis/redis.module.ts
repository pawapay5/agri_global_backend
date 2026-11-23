import { Global, Inject, Injectable, Module, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { APP_CONFIG, AppConfig } from "../../config/config";

export const REDIS = Symbol("REDIS");

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
      useFactory: (cfg: AppConfig) => new Redis(cfg.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false }),
    },
    RedisLifecycle,
    Cache,
  ],
  exports: [REDIS, Cache],
})
export class RedisModule {}
