/**
 * Expands country-pack holiday rules into dates.
 *   fixed:       { date: "03-06" }
 *   easter:      { easter_offset: -2 }          (Good Friday) — Western (Gregorian) Easter
 *   nth weekday: { month: 12, weekday: 5, nth: 1 }  (first Friday of December); nth -1 = last
 * Lunar holidays (e.g. Eid) are announced yearly and are added by admins, not computed.
 */
export interface HolidayRule { name: Record<string, string>; date?: string; easter_offset?: number; month?: number; weekday?: number; nth?: number; from_year?: number; to_year?: number }

/** Anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export function easterSunday(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}

export function expandHolidays(rules: HolidayRule[], years: number[]): { day: string; name: Record<string, string> }[] {
  const out: { day: string; name: Record<string, string> }[] = [];
  for (const y of years) {
    for (const r of rules) {
      if ((r.from_year && y < r.from_year) || (r.to_year && y > r.to_year)) continue;
      let d: Date | null = null;
      if (r.date) { const [m, dd] = r.date.split("-").map(Number); d = new Date(Date.UTC(y, m! - 1, dd!)); }
      else if (r.easter_offset != null) { d = easterSunday(y); d.setUTCDate(d.getUTCDate() + r.easter_offset); }
      else if (r.month && r.weekday != null && r.nth) {
        if (r.nth > 0) {
          d = new Date(Date.UTC(y, r.month - 1, 1));
          while (d.getUTCDay() !== r.weekday % 7) d.setUTCDate(d.getUTCDate() + 1);
          d.setUTCDate(d.getUTCDate() + 7 * (r.nth - 1));
        } else {
          d = new Date(Date.UTC(y, r.month, 0));
          while (d.getUTCDay() !== r.weekday % 7) d.setUTCDate(d.getUTCDate() - 1);
        }
      }
      if (d) out.push({ day: d.toISOString().slice(0, 10), name: r.name });
    }
  }
  return out;
}
