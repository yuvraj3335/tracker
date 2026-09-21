import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { addDays, differenceInCalendarDays, parseISO } from 'date-fns';
import { env } from './env';

/** A calendar day key, `yyyy-MM-dd`, in the app's configured timezone. */
export type DayKey = string;

export function todayKey(tz: string = env.timezone): DayKey {
  return formatInTimeZone(new Date(), tz, 'yyyy-MM-dd');
}

export function dayKeyOf(d: Date | string, tz: string = env.timezone): DayKey {
  const date = typeof d === 'string' ? parseISO(d) : d;
  return formatInTimeZone(date, tz, 'yyyy-MM-dd');
}

/**
 * Parse a `yyyy-MM-dd` key as **noon UTC**.
 *
 * The trailing Z matters. Without it, parseISO builds noon in the *server's*
 * local zone, while every formatter below reads the result back as UTC. In
 * IST or UTC that happens to land on the same calendar day, but in a UTC+13/+14
 * zone noon local is the previous day in UTC — so every date silently shifted
 * by one. Anchoring at noon UTC makes the whole module zone-independent, and
 * noon keeps it clear of DST transitions at either end of the day.
 */
export function keyToDate(key: DayKey): Date {
  return parseISO(key + 'T12:00:00Z');
}

export function shiftKey(key: DayKey, days: number): DayKey {
  return formatInTimeZone(addDays(keyToDate(key), days), 'UTC', 'yyyy-MM-dd');
}

export function formatKey(key: DayKey, fmt = 'EEE, d MMM yyyy'): string {
  return formatInTimeZone(keyToDate(key), 'UTC', fmt);
}

export function daysBetween(a: DayKey, b: DayKey): number {
  return differenceInCalendarDays(keyToDate(b), keyToDate(a));
}

export function isToday(key: DayKey): boolean {
  return key === todayKey();
}

/**
 * Builds the GitHub-style grid: 53 columns x 7 rows ending on the week that
 * contains `end`. Weeks start Sunday, matching GitHub's own layout.
 */
export function heatmapGrid(end: DayKey = todayKey(), weeks = 53): DayKey[][] {
  const endDate = keyToDate(end);
  // Week start is computed from the UTC weekday, not date-fns' startOfWeek,
  // which works in the server's local zone and would pick a different day in
  // far-eastern timezones. addDays on a noon-UTC date shifts by exact 24h
  // multiples, so the anchor stays noon UTC throughout.
  const lastWeekStart = addDays(endDate, -endDate.getUTCDay());
  const firstWeekStart = addDays(lastWeekStart, -7 * (weeks - 1));
  const cols: DayKey[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: DayKey[] = [];
    for (let d = 0; d < 7; d++) {
      col.push(formatInTimeZone(addDays(firstWeekStart, w * 7 + d), 'UTC', 'yyyy-MM-dd'));
    }
    cols.push(col);
  }
  return cols;
}

export function nowInZone(tz: string = env.timezone): Date {
  return toZonedTime(new Date(), tz);
}
