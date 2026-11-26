import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("quotes commas, quotes and newlines (RFC 4180)", () => {
    expect(toCsv(["a", "b"], [["x,y", 'say "hi"'], ["line\nbreak", 3]])).toBe('a,b\r\n"x,y","say ""hi"""\r\n"line\nbreak",3\r\n');
  });
  it("neutralises spreadsheet formulas but keeps negative numbers", () => {
    expect(toCsv(["v"], [["=HYPERLINK(\"x\")"], ["@SUM(A1)"], ["+1+1"], ["-12.5"], [-3]])).toBe("v\r\n\"'=HYPERLINK(\"\"x\"\")\"\r\n'@SUM(A1)\r\n'+1+1\r\n-12.5\r\n-3\r\n");
  });
  it("leaves empty cells for null and non-finite numbers", () => {
    expect(toCsv(["a", "b"], [[null, Number.NaN]])).toBe("a,b\r\n,\r\n");
  });
});
