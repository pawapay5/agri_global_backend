import {
  ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, HttpStatus, Logger, ValidationError, ValidationPipe,
} from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import type { Request, Response } from "express";

const BASE = "https://agriprice.app/problems/";

/** Domain error with a stable machine code; rendered as RFC 9457 problem+json. */
export class AppError extends HttpException {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super({ code, title, detail }, httpStatus);
  }
  static notFound(entity: string, detail?: string) { return new AppError(404, `${entity}_not_found`, `${entity} not found`, detail); }
  static unauthorized(code = "unauthorized", detail?: string) { return new AppError(401, code, "Unauthorized", detail); }
  static forbidden(code = "forbidden", detail?: string) { return new AppError(403, code, "Forbidden", detail); }
  static badRequest(code: string, detail?: string) { return new AppError(400, code, "Bad request", detail); }
  static conflict(code: string, detail?: string) { return new AppError(409, code, "Conflict", detail); }
  static tooMany(code: string, detail?: string, retryAfterSeconds?: number) {
    return new AppError(429, code, "Too many requests", detail, retryAfterSeconds ? { retryAfterSeconds } : undefined);
  }
  static unprocessable(code: string, detail: string) { return new AppError(422, code, "Unprocessable entity", detail); }
}

export class ValidationFailed extends BadRequestException {
  constructor(readonly errors: { field: string; message: string }[]) { super("validation_failed"); }
}

function flatten(errors: ValidationError[], prefix = ""): { field: string; message: string }[] {
  return errors.flatMap((e) => {
    const field = prefix ? `${prefix}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {}).map((message) => ({ field, message }));
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

export const validationPipe = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors) => new ValidationFailed(flatten(errors)),
  });

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger("http");

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = req.id;
    let body: Record<string, unknown>;
    let status: number;

    if (exception instanceof ValidationFailed) {
      status = 422;
      body = { type: `${BASE}validation`, title: "Validation failed", status, code: "validation_failed", errors: exception.errors };
    } else if (exception instanceof AppError) {
      status = exception.httpStatus;
      body = { type: BASE + exception.code.replace(/_/g, "-"), title: exception.title, status, code: exception.code, detail: exception.detail, ...exception.extra };
      if (exception.extra?.retryAfterSeconds) res.setHeader("Retry-After", String(exception.extra.retryAfterSeconds));
    } else if (exception instanceof ThrottlerException) {
      status = 429;
      body = { type: `${BASE}rate-limited`, title: "Too many requests", status, code: "rate_limited" };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      const detail = typeof r === "string" ? r : (r as { message?: string | string[] }).message;
      body = { type: "about:blank", title: HttpStatus[status] ?? "Error", status, code: `http_${status}`, detail: Array.isArray(detail) ? detail.join("; ") : detail };
    } else {
      status = 500;
      this.log.error({ err: exception, requestId }, "Unhandled error");
      body = { type: `${BASE}internal`, title: "Internal server error", status, code: "internal_error" };
    }
    res.status(status).type("application/problem+json").json({ ...body, instance: req.originalUrl, requestId });
  }
}
