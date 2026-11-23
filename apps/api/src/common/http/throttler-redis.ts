import type { ThrottlerStorage } from "@nestjs/throttler";
import type Redis from "ioredis";

interface ThrottlerStorageRecord { totalHits: number; timeToExpire: number; isBlocked: boolean; timeToBlockExpire: number }

/** Redis-backed fixed-window rate-limit storage, shared across API replicas. */
export class ThrottlerStorageRedisService implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const hitKey = `rl:${throttlerName}:${key}`;
    const blockKey = `${hitKey}:blocked`;
    const blockedTtl = await this.redis.pttl(blockKey);
    if (blockedTtl > 0) {
      return { totalHits: limit + 1, timeToExpire: Math.ceil(blockedTtl / 1000), isBlocked: true, timeToBlockExpire: Math.ceil(blockedTtl / 1000) };
    }
    const [[, hits], [, pttl]] = (await this.redis.multi().incr(hitKey).pttl(hitKey).exec()) as [[null, number], [null, number]];
    if (pttl < 0) await this.redis.pexpire(hitKey, ttl);
    const timeToExpire = Math.ceil((pttl > 0 ? pttl : ttl) / 1000);
    if (hits > limit) {
      await this.redis.set(blockKey, "1", "PX", blockDuration || ttl);
      return { totalHits: hits, timeToExpire, isBlocked: true, timeToBlockExpire: Math.ceil((blockDuration || ttl) / 1000) };
    }
    return { totalHits: hits, timeToExpire, isBlocked: false, timeToBlockExpire: 0 };
  }
}
