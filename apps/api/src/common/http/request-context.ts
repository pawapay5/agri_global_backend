import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export interface ClientMeta { ip: string | null; userAgent: string | null; requestId: string | null; installationId: string | null }

/** Assigns/propagates X-Request-Id. */
export function requestId(req: Request & { id?: string }, res: Response, next: NextFunction) {
  const incoming = req.header("x-request-id");
  req.id = incoming && /^[\w-]{8,128}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
}

export const Client = createParamDecorator((_: unknown, ctx: ExecutionContext): ClientMeta => {
  const req = ctx.switchToHttp().getRequest<Request & { id?: string }>();
  return {
    ip: req.ip ?? null,
    userAgent: req.header("user-agent")?.slice(0, 512) ?? null,
    requestId: req.id ?? null,
    installationId: req.header("x-installation-id")?.slice(0, 128) ?? null,
  };
});

/** Opaque, tamper-evident-enough cursor (base64url JSON). Values are re-validated by queries. */
export const cursor = {
  encode: (v: Record<string, string | number>) => Buffer.from(JSON.stringify(v)).toString("base64url"),
  decode<T extends Record<string, string | number>>(s?: string): T | null {
    if (!s) return null;
    try { return JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as T; } catch { return null; }
  },
};
