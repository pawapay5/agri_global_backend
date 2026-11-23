import { describe, expect, it } from "vitest";
import { toCsv, toHtml, toXlsx } from "./reports";

const tables = [{ title: "Summary", columns: ["Commodity", "Average"], rows: [["Maize, white", "12.50"], ["=cmd()", null]] }];

describe("report renderers", () => {
  it("writes CSV with BOM, quoting and formula-injection guard", () => {
    const s = toCsv(tables).toString("utf8");
    expect(s.startsWith("﻿# Summary")).toBe(true);
    expect(s).toContain('"Maize, white",12.50');
    expect(s.split("\n")).toContain("'=cmd(),");
  });
  it("escapes HTML", () => {
    const h = toHtml("<Report>", [{ title: "T", columns: ["a"], rows: [["<script>"]] }], new Date("2026-01-01T00:00:00Z"));
    expect(h).toContain("&lt;Report&gt;");
    expect(h).not.toContain("<script>");
  });
  it("builds a valid XLSX (zip) buffer", async () => {
    const b = await toXlsx("Title", tables);
    expect(b.subarray(0, 2).toString()).toBe("PK");
  });
});
