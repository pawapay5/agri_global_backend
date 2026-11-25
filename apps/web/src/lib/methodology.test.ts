import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { METHODOLOGY } from "./methodology";

/** The methodology page must state what the code does: compare against the sources of truth. */
const repo = join(process.cwd(), "..", "..");
const ml = readFileSync(join(repo, "apps", "ml", "agriprice_ml", "__init__.py"), "utf8");
const ingest = readFileSync(join(repo, "apps", "api", "src", "modules", "prices", "ingest.service.ts"), "utf8");
const num = (name: string) => Number(ml.match(new RegExp(`^${name}\\s*=\\s*([\\d.]+)`, "m"))?.[1]);

describe("methodology page numbers match the code", () => {
  it("forecast guardrails (apps/ml)", () => {
    expect(num("MIN_HISTORY_WEEKS")).toBe(METHODOLOGY.minHistoryWeeks);
    expect(num("MAX_STALENESS_DAYS")).toBe(METHODOLOGY.maxStalenessDays);
    expect(num("MAX_BACKTEST_MAPE")).toBe(METHODOLOGY.maxBacktestMape);
    const horizons = ml.match(/HORIZON_WEEKS\s*=\s*\{([^}]*)\}/)?.[1].match(/(\d+)\s*:/g)?.map((h) => Number(h.replace(":", "")));
    expect(horizons).toEqual([...METHODOLOGY.horizonsMonths]);
  });
  it("outlier reference window (apps/api ingest)", () => {
    expect(ingest).toContain(`interval '${METHODOLOGY.outlierWindowDays} days'`);
  });
});
