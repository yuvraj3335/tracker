/**
 * Focus-timer arithmetic.
 *
 * All of it is pure and clock-free: every function takes the numbers it needs
 * and returns a value, so the whole of the timer's behaviour — including the
 * awkward parts, like a tab that was backgrounded across the five-minute mark —
 * is testable without a browser or a fake clock. The component's only job is to
 * sample a monotonic clock and hand the result to these.
 */

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

/** The warning the brief asks for: five minutes left. */
export const WARNING_MS = 5 * MINUTE;
/** The last stretch, where the display stops being merely informative. */
export const CRITICAL_MS = MINUTE;

/**
 * An upper bound, so a typo cannot start a timer that outlives the session.
 * Twelve hours is past anything anyone would sit down to and still short
 * enough that "120" being read as minutes rather than seconds stays obviously
 * correct.
 */
export const MAX_DURATION_MS = 12 * HOUR;

/** mm:ss, or hh:mm:ss. The minutes and seconds fields are real clock fields. */
const CLOCK = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/;
/** "1h30m", "45 min", "90s" — every part optional, so an empty match is possible. */
const UNITS =
  /^(?:(\d+)\s*h(?:ou)?r?s?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?\s*(?:(\d+)\s*s(?:ec(?:ond)?s?)?)?$/;
const BARE = /^\d+$/;

/**
 * A typed duration, in milliseconds, or null if it is not one.
 *
 * Null rather than a thrown error or a silent zero: this reads straight off an
 * input event on every keystroke, and the caller's job is to keep the start
 * button disabled until it stops being null.
 *
 * A bare number is minutes. That is what someone typing "25" into a focus
 * timer means, and reading it as milliseconds or seconds would produce a timer
 * that ends before they look up.
 */
export function parseDuration(input: unknown): number | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (!s) return null;

  let ms: number;
  const clock = CLOCK.exec(s);
  if (clock) {
    const [, a, b, c] = clock;
    // Two fields is minutes:seconds, three is hours:minutes:seconds — the same
    // reading a stopwatch gets.
    ms =
      c === undefined
        ? Number(a) * MINUTE + Number(b) * SECOND
        : Number(a) * HOUR + Number(b) * MINUTE + Number(c) * SECOND;
  } else if (BARE.test(s)) {
    ms = Number(s) * MINUTE;
  } else {
    const u = UNITS.exec(s);
    // Every group in UNITS is optional, so it also matches the empty string and
    // anything that is only separators. A match with no captured number is not
    // a duration.
    if (!u || (!u[1] && !u[2] && !u[3])) return null;
    ms = Number(u[1] ?? 0) * HOUR + Number(u[2] ?? 0) * MINUTE + Number(u[3] ?? 0) * SECOND;
  }

  // Zero is refused along with everything negative or absurd: a timer that is
  // already finished is not a timer, and "0" is far more likely to be a
  // half-typed number than an intention.
  if (!Number.isFinite(ms) || ms <= 0 || ms > MAX_DURATION_MS) return null;
  return ms;
}

/**
 * The countdown display.
 *
 * Rounded up, which is what makes a countdown read correctly: a timer showing
 * 0:01 should still have a second to run, and one showing 0:00 should be over.
 * Rounding down would show 0:00 for the whole final second.
 *
 * Minutes are unpadded below an hour ("9:05", not "09:05") so the digits are as
 * large as they can be at a given width, and padded above one so the fields
 * stay in their columns.
 */
export function formatRemaining(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / SECOND);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The same duration in words, for the label a screen reader reads. */
export function describeRemaining(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / SECOND);
  if (total === 0) return 'no time left';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  // Seconds are dropped once there is an hour on the clock: "2 hours, 3
  // minutes and 41 seconds" is read out on every poll and helps nobody.
  if (s && !h) parts.push(`${s} second${s === 1 ? '' : 's'}`);
  return `${parts.join(' ')} left`;
}

/**
 * Which tier the remaining time is in.
 *
 * The boundaries are inclusive on the way down — five minutes exactly is
 * already the warning — because "when 5 minutes remain" is the moment the
 * clock reads 5:00, not the moment it drops below it.
 */
export type TimerPhase = 'running' | 'warning' | 'critical' | 'done';

export function phaseFor(remaining: number): TimerPhase {
  if (remaining <= 0) return 'done';
  if (remaining <= CRITICAL_MS) return 'critical';
  if (remaining <= WARNING_MS) return 'warning';
  return 'running';
}

/** Never negative: an overdue timer is finished, not counting the other way. */
export function remainingMs(endsAt: number, now: number): number {
  return Math.max(0, endsAt - now);
}

/** How much of the session is gone, 0..1. Zero-length durations read as done. */
export function elapsedFraction(remaining: number, total: number): number {
  if (!(total > 0)) return 1;
  return Math.min(1, Math.max(0, 1 - remaining / total));
}

/**
 * Whether this sample is the one that crossed a threshold going down.
 *
 * Comparing two samples rather than testing the current value is what makes
 * the warning survive a backgrounded tab: timers are throttled to once a
 * minute or worse in a hidden tab, so the sample that follows can land well
 * past the mark. `prev` of 8 minutes and `next` of 2 still crossed 5.
 *
 * It is also why a timer started at or under five minutes never chimes on
 * start: `prev` begins at the total, which was never above the threshold.
 */
export function crossedBelow(prev: number, next: number, threshold: number): boolean {
  return prev > threshold && next <= threshold;
}

/**
 * Wall-clock time, in the app's configured zone.
 *
 * The same zone that decides when a day rolls over for streaks and the
 * heatmap, so the clock on the focus screen and the date on the dashboard
 * never disagree about what time it is.
 *
 * Formatters are cached: this is called once a second for as long as the page
 * is open, and building an Intl.DateTimeFormat is not free.
 */
const clockFormatters = new Map<string, Intl.DateTimeFormat>();

export function formatClock(epochMs: number, timeZone?: string): string {
  const key = timeZone ?? '';
  let formatter = clockFormatters.get(key);
  if (!formatter) {
    const options: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    };
    try {
      formatter = new Intl.DateTimeFormat('en-GB', timeZone ? { ...options, timeZone } : options);
    } catch {
      // A misconfigured APP_TIMEZONE is not worth taking the timer down for;
      // the countdown itself does not depend on a zone at all.
      formatter = new Intl.DateTimeFormat('en-GB', options);
    }
    clockFormatters.set(key, formatter);
  }
  return formatter.format(epochMs);
}

/**
 * The wall-clock time a running session will finish at.
 *
 * Worth showing because it answers the question people actually have — "can I
 * make the 4 o'clock?" — which a count of minutes does not.
 */
export function finishesAt(nowMs: number, remaining: number, timeZone?: string): string {
  return formatClock(nowMs + Math.max(0, remaining), timeZone);
}
