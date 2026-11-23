import { Global, MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "./common/http/throttler-redis";
import { APP_CONFIG, loadConfig } from "./config/config";
import { AuditModule } from "./common/audit/audit.service";
import { AuthCommonModule, JwtAuthGuard, RolesGuard } from "./common/auth/auth.common";
import { DatabaseModule } from "./common/db/database.module";
import { ProblemFilter } from "./common/http/problem";
import { requestId } from "./common/http/request-context";
import { I18nModule } from "./common/i18n/i18n.service";
import { MoneyModule } from "./common/money/money.service";
import { QueueModule } from "./common/queue/queues";
import { REDIS, RedisModule } from "./common/redis/redis.module";
import { StorageModule } from "./common/storage/storage.service";
import { AlertsModule } from "./modules/alerts/alerts.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CatalogueModule } from "./modules/catalogue/catalogue.module";
import { ForecastsModule } from "./modules/forecasts/forecasts.module";
import { GeoModule } from "./modules/geo/geo.module";
import { HealthModule } from "./modules/health/health.controller";
import { InsightsModule } from "./modules/insights/insights.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { PricesModule } from "./modules/prices/prices.module";
import { UsersModule } from "./modules/users/users.module";

@Global()
@Module({ providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }], exports: [APP_CONFIG] })
class ConfigModule {}

@Module({
  imports: [
    ConfigModule, DatabaseModule, RedisModule, QueueModule, AuthCommonModule, AuditModule, I18nModule, MoneyModule, StorageModule,
    ThrottlerModule.forRootAsync({
      inject: [REDIS],
      useFactory: (redis) => ({
        throttlers: [{ name: "default", ttl: 60_000, limit: 120 }],
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
    HealthModule, AuthModule, UsersModule, GeoModule, CatalogueModule, PricesModule, ForecastsModule, InsightsModule, AlertsModule, NotificationsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ProblemFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) { consumer.apply(requestId).forRoutes("*"); }
}
