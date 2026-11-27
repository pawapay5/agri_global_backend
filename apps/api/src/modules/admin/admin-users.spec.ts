import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { AdminService, canAssign } from "./admin.module";

describe("who can give which role", () => {
  it("lets admins give any role, including org admin and agronomist", () => {
    for (const r of ["farmer", "consumer", "agronomist", "org_admin", "admin"]) expect(canAssign("admin", r)).toBe(true);
  });
  it("keeps org admins to everyday roles and enumerators", () => {
    expect(canAssign("org_admin", "farmer")).toBe(true);
    expect(canAssign("org_admin", "enumerator")).toBe(true);
    expect(canAssign("org_admin", "org_admin")).toBe(false);
    expect(canAssign("org_admin", "admin")).toBe(false);
    expect(canAssign("farmer", "farmer")).toBe(false);
  });
});

describe("adding people", () => {
  function setup(existing = false) {
    const sql = { one: vi.fn().mockResolvedValue(existing ? { "?column?": 1 } : null), many: vi.fn(), exec: vi.fn() };
    const audit = { record: vi.fn() };
    const queue = { dispatch: vi.fn() };
    const users = { create: vi.fn(async (v: Record<string, unknown>) => ({ id: "new", ...v, createdAt: new Date(), updatedAt: new Date() })) };
    const svc = new AdminService(sql as never, audit as never, queue as never, {} as never, users as never, {} as never, {} as never);
    return { svc, users, queue, audit };
  }
  const d = { fullName: "Ama Mensah", email: "Ama@Example.com", role: "org_admin" as const, country: "NG" };

  it("creates the account without a password and emails an invitation", async () => {
    const { svc, users, queue, audit } = setup();
    await svc.createUser({ id: "a", role: "admin", country: "GH" } as never, d as never);
    expect(users.create).toHaveBeenCalledWith(expect.objectContaining({ email: "ama@example.com", role: "org_admin", countryIso2: "NG" }));
    expect(users.create.mock.calls[0]![0]).not.toHaveProperty("passwordHash");
    const job = queue.dispatch.mock.calls[0]![0];
    expect(job.channels).toContain("email");
    expect(String(job.params.body)).toContain("forgot-password?email=ama%40example.com");
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.user.create" }));
  });

  it("keeps org admins to their country and their assignable roles", async () => {
    const { svc, users } = setup();
    await expect(svc.createUser({ id: "o", role: "org_admin", country: "GH" } as never, d as never)).rejects.toMatchObject({ code: "role_not_assignable" });
    await svc.createUser({ id: "o", role: "org_admin", country: "GH" } as never, { ...d, role: "enumerator" } as never);
    expect(users.create.mock.calls[0]![0]).toMatchObject({ countryIso2: "GH" });
  });

  it("refuses an email that already has an account", async () => {
    const { svc } = setup(true);
    await expect(svc.createUser({ id: "a", role: "admin", country: "GH" } as never, d as never)).rejects.toMatchObject({ code: "account_exists" });
  });
});
