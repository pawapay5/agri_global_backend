import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp } from "./client-ip";
import { buildCsp } from "./csp";
import { newCsrfToken, readCsrfCookie, tokensMatch } from "./csrf";
import { ipAllowed, parseAllowlist } from "./ip-allowlist";

vi.mock("server-only", () => ({}));

describe("ip allow-list", () => {
  it("is open when unset", () => expect(ipAllowed("1.2.3.4", parseAllowlist(""))).toBe(true));
  it("matches IPv4 CIDRs and exact addresses", () => {
    const r = parseAllowlist("203.0.113.0/24, 198.51.100.7");
    expect(ipAllowed("203.0.113.250", r)).toBe(true);
    expect(ipAllowed("198.51.100.7", r)).toBe(true);
    expect(ipAllowed("198.51.100.8", r)).toBe(false);
    expect(ipAllowed("203.0.114.1", r)).toBe(false);
  });
  it("matches IPv6 and IPv4-mapped IPv6", () => {
    const r = parseAllowlist("2001:db8::/32 10.0.0.0/8");
    expect(ipAllowed("2001:db8:abcd::1", r)).toBe(true);
    expect(ipAllowed("2001:db9::1", r)).toBe(false);
    expect(ipAllowed("::ffff:10.1.2.3", r)).toBe(true);
  });
  it("denies unknown or garbage IPs when a list is set, and ignores bad entries", () => {
    const r = parseAllowlist("not-an-ip, 10.0.0.0/33, 10.0.0.0/8");
    expect(r).toHaveLength(1);
    expect(ipAllowed(null, r)).toBe(false);
    expect(ipAllowed("10.0.0.256", r)).toBe(false);
  });
});

describe("clientIp", () => {
  afterEach(() => { delete process.env.CLIENT_IP_HEADER; });
  it("takes the right-most X-Forwarded-For entry (the one our proxy appended)", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 41.66.1.2" }))).toBe("41.66.1.2");
  });
  it("prefers the configured header (e.g. Cloudflare)", () => {
    process.env.CLIENT_IP_HEADER = "CF-Connecting-IP";
    expect(clientIp(new Headers({ "cf-connecting-ip": "41.1.1.1", "x-forwarded-for": "172.16.0.1" }))).toBe("41.1.1.1");
  });
  it("returns null without proxy headers", () => expect(clientIp(new Headers())).toBeNull());
});

describe("csrf", () => {
  it("issues long random tokens and compares exactly", () => {
    const a = newCsrfToken(), b = newCsrfToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(tokensMatch(a, a)).toBe(true);
    expect(tokensMatch(a, b)).toBe(false);
    expect(tokensMatch(a, null)).toBe(false);
    expect(tokensMatch("short", "short")).toBe(false);
  });
  it("reads the token from either cookie name", () => {
    expect(readCsrfCookie("x=1; __Host-ap_csrf=abc%3D; y=2")).toBe("abc=");
    expect(readCsrfCookie("ap_csrf=dev")).toBe("dev");
    expect(readCsrfCookie("other=1")).toBeNull();
  });
});

describe("csp", () => {
  it("nonce policy is strict (no unsafe-inline for scripts)", () => {
    const p = buildCsp({ nonce: "abc", dev: false });
    const script = p.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toContain("'nonce-abc'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("unsafe-inline");
    expect(script).not.toContain("unsafe-eval");
    expect(p).toContain("frame-ancestors 'none'");
    expect(p).toContain("object-src 'none'");
    expect(p).toContain("upgrade-insecure-requests");
  });
  it("cacheable policy allows inline bootstrap scripts but nothing else third-party", () => {
    const script = buildCsp({ dev: false }).split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toBe("script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client https://appleid.cdn-apple.com");
  });
});

describe("rate limit", () => {
  const store = (counts: number[]) => {
    let i = 0;
    return { multi: () => { const chain = { incr: () => chain, expire: () => chain, exec: async () => [[null, counts[i++]], [null, 1]] }; return chain; } };
  };
  it("allows up to max, then returns retry-after within the window", async () => {
    const { hit } = await import("./rate-limit");
    const limit = { name: "t", max: 2, windowSeconds: 60 };
    const s = store([1, 2, 3]) as never;
    expect(await hit(limit, "ip", s)).toEqual({ ok: true });
    expect(await hit(limit, "ip", s)).toEqual({ ok: true });
    const v = await hit(limit, "ip", s);
    expect(v.ok).toBe(false);
    if (!v.ok) { expect(v.retryAfterSeconds).toBeGreaterThan(0); expect(v.retryAfterSeconds).toBeLessThanOrEqual(60); }
  });
  it("fails open when Redis errors or isn't configured", async () => {
    const { hit } = await import("./rate-limit");
    const broken = { multi: () => { const c = { incr: () => c, expire: () => c, exec: async () => { throw new Error("down"); } }; return c; } } as never;
    expect(await hit({ name: "t", max: 1, windowSeconds: 60 }, "ip", broken)).toEqual({ ok: true });
    expect(await hit({ name: "t", max: 1, windowSeconds: 60 }, "ip", null)).toEqual({ ok: true });
  });
});
