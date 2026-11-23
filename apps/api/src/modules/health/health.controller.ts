import { Controller, Get, Inject, Module, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { Response } from "express";
import type Redis from "ioredis";
import { Public } from "../../common/auth/auth.common";
import { Sql } from "../../common/db/database.module";
import { REDIS } from "../../common/redis/redis.module";

const VERSION = process.env.APP_VERSION ?? "dev";

@ApiTags("health")
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(private readonly sql: Sql, @Inject(REDIS) private readonly redis: Redis) {}

  @Public() @Get("healthz")
  @ApiOperation({ operationId: "health_live" })
  live() { return { status: "ok", version: VERSION }; }

  @Public() @Get("readyz")
  @ApiOperation({ operationId: "health_ready" })
  async ready(@Res({ passthrough: true }) res: Response) {
    const [db, redis] = await Promise.all([this.sql.ping(), this.redis.ping().then(() => true).catch(() => false)]);
    const checks = { postgres: db ? "up" : "down", redis: redis ? "up" : "down" } as const;
    const ok = db && redis;
    if (!ok) res.status(503);
    return { status: ok ? "ok" : "down", checks, version: VERSION };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
