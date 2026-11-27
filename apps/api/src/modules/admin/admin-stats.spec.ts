import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { AdminStatsService, fillDays } from "./admin-stats";

describe("admin stats", () => {
  it("fills quiet days with zeros, oldest first, ending today", () => {
    const today = new Date("2026-11-26T15:00:00Z");
    const out = fillDays<{ count: number }>([{ d: "2026-11-25", count: 4 }], 3, ["count"], today);
    expect(out).toEqual([{ date: "2026-11-24", count: 0 }, { date: "2026-11-25", count: 4 }, { date: "2026-11-26", count: 0 }]);
  });

  it("keeps org admins to their country and hides admin-only queues", async () => {
    const one = vi.fn().mockResolvedValue({ prices_pending: "3", prices_flagged: "1", seller_applications: "2", moderation_open: "9", disputes_open: "4", payouts_pending: "5" });
    const many = vi.fn().mockResolvedValue([]);
    const svc = new AdminStatsService({ one, many } as never, { wrap: (_k: string, _t: number, fn: () => unknown) => fn() } as never);
    const r = await svc.stats({ id: "o", role: "org_admin", country: "GH" } as never, { days: 7, country: "NG" });
    expect(r.country).toBe("GH");
    expect(one.mock.calls[0]![1]).toEqual(["GH"]);
    expect(r.queues).toEqual({ pricesPending: 3, pricesFlagged: 1, sellerApplications: 2, moderationOpen: null, disputesOpen: null, payoutsPending: null });
    expect(r.signups).toHaveLength(7);
    const a = await svc.stats({ id: "a", role: "admin", country: "GH" } as never, { days: 30 });
    expect(a.country).toBeNull();
    expect(a.queues.moderationOpen).toBe(9);
  });
});
