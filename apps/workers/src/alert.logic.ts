/** Pure alert evaluation rules (unit-tested). */

export interface AlertState {
  condition: "above" | "below" | "pct_change";
  thresholdPerKgLocal: number | null; // above/below
  threshold: number;                  // pct_change: signed percent
  lastState: boolean | null;
  lastTriggeredAt: Date | null;
  cooldownHours: number;
}

export interface Evaluation { met: boolean; direction: "above" | "below"; changePct: number | null; compared: number }

/** Is the alert condition true for the current value (and reference value for pct_change)? */
export function conditionMet(a: AlertState, value: number, reference: number | null): Evaluation | null {
  if (a.condition === "pct_change") {
    if (reference == null || reference <= 0) return null; // can't judge without a baseline
    const changePct = Math.round(((value - reference) / reference) * 10_000) / 100;
    const met = a.threshold > 0 ? changePct >= a.threshold : changePct <= a.threshold;
    return { met, direction: changePct >= 0 ? "above" : "below", changePct, compared: a.threshold };
  }
  const thr = a.thresholdPerKgLocal!;
  const met = a.condition === "above" ? value >= thr : value <= thr;
  return { met, direction: a.condition, changePct: reference && reference > 0 ? Math.round(((value - reference) / reference) * 10_000) / 100 : null, compared: thr };
}

export type FireDecision = { fire: true } | { fire: false; reason: "not_met" | "already_in_state" | "cooldown" };

/**
 * Edge-triggered with cooldown: fire only on a transition into the condition,
 * and never more often than once per cooldown window.
 */
export function shouldFire(a: Pick<AlertState, "lastState" | "lastTriggeredAt" | "cooldownHours">, met: boolean, now = new Date()): FireDecision {
  if (!met) return { fire: false, reason: "not_met" };
  if (a.lastState === true) return { fire: false, reason: "already_in_state" };
  if (a.lastTriggeredAt && now.getTime() - a.lastTriggeredAt.getTime() < a.cooldownHours * 3_600_000) return { fire: false, reason: "cooldown" };
  return { fire: true };
}

/** Minutes since local midnight in a timezone. */
export function localMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")!.value), m = Number(parts.find((p) => p.type === "minute")!.value);
  return h * 60 + m;
}

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h! * 60 + m!; };

/** 0 when outside quiet hours; otherwise ms until quiet hours end. Handles windows crossing midnight. */
export function quietHoursDelayMs(now: Date, start: string | null, end: string | null, timeZone: string | null): number {
  if (!start || !end || !timeZone || start === end) return 0;
  const cur = localMinutes(now, timeZone), s = toMin(start), e = toMin(end);
  const inside = s < e ? cur >= s && cur < e : cur >= s || cur < e;
  if (!inside) return 0;
  const minutesLeft = (e - cur + 1440) % 1440;
  return minutesLeft * 60_000 - now.getUTCSeconds() * 1000;
}

/** Minimal {{mustache}} renderer: unknown keys render empty; values are plain text. */
export function render(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (params[k] == null ? "" : String(params[k])));
}
