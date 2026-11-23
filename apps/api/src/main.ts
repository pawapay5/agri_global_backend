import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { loadConfig } from "./config/config";
import { validationPipe } from "./common/http/problem";
import { buildOpenApi, mountDocs } from "./openapi/openapi";

async function bootstrap() {
  const cfg = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: cfg.env === "production" ? undefined : false }));
  app.useBodyParser("json", { limit: "1mb" });
  app.useBodyParser("urlencoded", { extended: true, limit: "256kb" });
  app.enableCors({
    origin: cfg.corsOrigins,
    credentials: false,
    allowedHeaders: ["Authorization", "Content-Type", "Accept-Language", "X-Currency", "X-Unit", "X-Installation-Id", "X-Request-Id", "Idempotency-Key"],
    exposedHeaders: ["X-Request-Id", "Retry-After"],
  });
  app.useGlobalPipes(validationPipe());
  app.enableShutdownHooks();
  if (cfg.env !== "production") mountDocs(app, buildOpenApi(app));
  await app.listen(cfg.port);
  new Logger("bootstrap").log(`AgriPrice API listening on :${cfg.port}`);
}

void bootstrap();
