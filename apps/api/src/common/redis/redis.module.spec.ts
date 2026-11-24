import { Logger } from "@nestjs/common";
import Redis from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withConnectionLogging } from "./redis.module";

describe("withConnectionLogging", () => {
  afterEach(() => vi.restoreAllMocks());
  const make = () => withConnectionLogging(new Redis("redis://user:secret@localhost:1", { lazyConnect: true }), "redis://user:secret@localhost:1");

  it("logs once per outage, hides credentials, and logs recovery", () => {
    const err = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const ok = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const r = make();
    const e = Object.assign(new Error("x"), { code: "ECONNREFUSED" });
    r.emit("error", e); r.emit("error", e); r.emit("error", e);
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]?.[0])).toContain("redis://***@localhost:1");
    expect(String(err.mock.calls[0]?.[0])).not.toContain("secret");
    r.emit("ready");
    expect(ok).toHaveBeenCalledTimes(1);
    r.emit("error", e);
    expect(err).toHaveBeenCalledTimes(2);
    r.disconnect();
  });

  it("duplicated clients share one status: one line per outage, one on full recovery", () => {
    const err = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const ok = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const root = make();
    const a = root.duplicate(), b = root.duplicate();
    expect(a.listenerCount("error")).toBe(1);
    for (const c of [root, a, b]) c.emit("error", new Error("ECONNREFUSED"));
    expect(err).toHaveBeenCalledTimes(1);
    root.emit("ready"); a.emit("ready");
    expect(ok).not.toHaveBeenCalled(); // b still down
    b.emit("ready");
    expect(ok).toHaveBeenCalledTimes(1);
    for (const c of [root, a, b]) c.disconnect();
  });
});
