import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { revalidateWeb } from "./revalidate";

const log = pino({ level: "silent" });

describe("revalidateWeb", () => {
  it("is a no-op when not configured", async () => {
    const f = vi.fn();
    expect(await revalidateWeb(["GH"], {}, log, f)).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });

  it("posts once per distinct country with the secret", async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const n = await revalidateWeb(["GH", "gh", "KE"], { url: "http://web/api/revalidate", secret: "s" }, log, f);
    expect(n).toBe(2);
    expect(f).toHaveBeenCalledTimes(2);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("http://web/api/revalidate");
    expect(init.headers["x-revalidate-secret"]).toBe("s");
    expect(JSON.parse(init.body)).toEqual({ country: "GH", scopes: ["prices"] });
  });

  it("swallows network errors and rejected responses", async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await revalidateWeb(["GH", "KE"], { url: "u", secret: "s" }, log, f)).toBe(0);
  });
});
