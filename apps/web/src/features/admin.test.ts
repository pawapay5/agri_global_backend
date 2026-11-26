import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sectionsFor } from "@/components/shell/admin-shell";
import { ADMIN_TABLES, field } from "@/lib/api/admin";
import { columnsFor, parseRow } from "./admin-catalogue";
import { broadcastProblem } from "./admin-platform";

describe("field", () => {
  it("reads camelCase or the API's snake_case", () => {
    expect(field({ created_at: "x" }, "createdAt")).toBe("x");
    expect(field({ createdAt: "y", created_at: "x" }, "createdAt")).toBe("y");
    expect(field({ country_iso2: "GH" }, "countryIso2")).toBe("GH");
    expect(field(null, "id")).toBeUndefined();
  });
});

describe("sectionsFor", () => {
  const keys = (role: string) => sectionsFor(role).flatMap((g) => g.items.map((i) => i.key));
  it("gives admins everything", () => expect(keys("admin")).toContain("audit"));
  it("keeps enumerators to price work", () => expect(keys("enumerator")).toEqual(["overview", "review", "import"]));
  it("hides money and moderation from org admins", () => {
    expect(keys("org_admin")).not.toContain("payouts");
    expect(keys("org_admin")).not.toContain("moderation");
  });
});

describe("catalogue editor", () => {
  it("lists exactly the tables the contract allows", () => {
    const spec = readFileSync(resolve(__dirname, "../../../../openapi/openapi.yaml"), "utf8");
    const enumLine = spec.split("\n").find((l) => l.trim().startsWith("AdminTable:"))!;
    const allowed = enumLine.match(/enum: \[([^\]]+)\]/)![1]!.split(",").map((s) => s.trim());
    expect([...ADMIN_TABLES].sort()).toEqual([...allowed].sort());
  });
  it("picks readable columns and skips heavy or secret fields", () => {
    const cols = columnsFor([{ id: "1", code: "tomato", name: { en: "Tomato" }, search: "x", big: { a: 1 }, active: true }]);
    expect(cols[0]).toBe("code");
    expect(cols).not.toContain("search");
    expect(cols).not.toContain("big");
    expect(cols).not.toContain("id");
  });
  it("only accepts a JSON object", () => {
    expect(parseRow('{"code":"x"}')).toEqual({ ok: true, value: { code: "x" } });
    expect(parseRow("[1]")).toEqual({ ok: false, error: "object" });
    expect(parseRow("{ nope").ok).toBe(false);
  });
});

describe("broadcastProblem", () => {
  const ok = { country: "GH", title: "Market closed Friday", body: "Kumasi Central is closed for cleaning.", channels: ["in_app"] };
  it("accepts a complete broadcast", () => expect(broadcastProblem(ok)).toBeNull());
  it("checks country, lengths and channels", () => {
    expect(broadcastProblem({ ...ok, country: "" })).toBe("pickCountry");
    expect(broadcastProblem({ ...ok, title: "x".repeat(121) })).toBe("titleBad");
    expect(broadcastProblem({ ...ok, body: " " })).toBe("bodyBad");
    expect(broadcastProblem({ ...ok, channels: [] })).toBe("pickChannel");
  });
});
