import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { KycReviewService, maskId } from "./kyc-review";

const admin = { id: "a1", role: "admin", country: "GH" } as never;
const orgAdmin = { id: "o1", role: "org_admin", country: "GH" } as never;

function setup(updated: { user_id: string } | null = { user_id: "u1" }) {
  const sql = { one: vi.fn().mockResolvedValue(updated), many: vi.fn().mockResolvedValue([]), exec: vi.fn() };
  const queue = { dispatch: vi.fn() };
  const audit = { record: vi.fn() };
  const svc = new KycReviewService(sql as never, { decrypt: (s: string) => s } as never, {} as never, audit as never, queue as never);
  return { svc, sql, queue, audit };
}

describe("seller approvals", () => {
  it("masks all but the last four characters of an ID number", () => {
    expect(maskId("GHA-123456789-0")).toBe("••••••••89-0");
    expect(maskId("1234")).toBe("••••");
  });

  it("approves, notifies the applicant and audits the decision", async () => {
    const { svc, sql, queue, audit } = setup();
    await svc.decide(admin, "u1", { decision: "approve" });
    expect(sql.one.mock.calls[0]![1]).toEqual(["u1", "verified", "a1", null, null]);
    expect(queue.dispatch).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", templateKey: "seller.kyc_approved" }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.kyc.approve", entityId: "u1" }));
  });

  it("needs a reason to reject, and passes it on to the applicant", async () => {
    const { svc, queue } = setup();
    await expect(svc.decide(admin, "u1", { decision: "reject", reason: "  " })).rejects.toMatchObject({ code: "reason_required" });
    await svc.decide(admin, "u1", { decision: "reject", reason: "The ID photo is blurred." });
    expect(String(queue.dispatch.mock.calls[0]![0].params.body)).toContain("The ID photo is blurred.");
  });

  it("keeps org admins to their own country and stops self-approval", async () => {
    const { svc, sql } = setup();
    await svc.decide(orgAdmin, "u1", { decision: "approve" });
    expect(sql.one.mock.calls[0]![1][4]).toBe("GH");
    await expect(svc.decide(admin, "a1", { decision: "approve" })).rejects.toMatchObject({ code: "own_application" });
  });

  it("reports an application that isn't pending any more", async () => {
    const { svc, queue } = setup(null);
    await expect(svc.decide(admin, "u1", { decision: "approve" })).rejects.toMatchObject({ code: "kyc_application_not_found" });
    expect(queue.dispatch).not.toHaveBeenCalled();
  });
});
