/**
 * Numbers the public methodology page states. They mirror the code that enforces them and a test
 * (methodology.test.ts) fails if either side changes without the other:
 * - apps/ml/agriprice_ml/__init__.py: forecast guardrails;
 * - apps/api/src/modules/prices/ingest.service.ts: the outlier reference window.
 */
export const METHODOLOGY = {
  minHistoryWeeks: 26,
  maxStalenessDays: 21,
  maxBacktestMape: 25,
  horizonsMonths: [1, 3, 6],
  outlierWindowDays: 90,
} as const;
