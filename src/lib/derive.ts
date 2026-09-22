/**
 * Everything in here is *derived* from `Task.Completed On`.
 *
 * That is the whole point of the design: you tick a question off, and the
 * Daily Tracker entry, the heatmap cell, the streak, and the Job Switch
 * rollup all follow from that one date. There is no second place to log.
 */
import type { Area, Task, Topic, DailyNote } from './notion';
import { type DayKey, daysBetween, shiftKey, todayKey } from './date';
import { DIFFICULTY, type Difficulty } from './schema';

/** Every completed task bucketed by the day it was completed. */
export function activityByDay(tasks: Task[]): Map<DayKey, Task[]> {
  const m = new Map<DayKey, Task[]>();
  for (const t of tasks) {
    if (!t.done || !t.completedOn) continue;
    const key = t.completedOn.slice(0, 10);
    const list = m.get(key);
    if (list) list.push(t);
    else m.set(key, [t]);
  }
  // Keep each day in sheet order so a day reads like the sheet does.
  for (const list of m.values()) list.sort((a, b) => a.order - b.order);
  return m;
}

export function countsByDay(tasks: Task[]): Map<DayKey, number> {
  const m = new Map<DayKey, number>();
  for (const [k, v] of activityByDay(tasks)) m.set(k, v.length);
  return m;
}

/**
 * Current and longest streak of consecutive active days.
 * Today not yet being logged does not break the current streak — a streak
 * ending yesterday is still "live" until today is over.
 */
export function streaks(tasks: Task[]): { current: number; longest: number; lastActive: DayKey | null } {
  const days = [...countsByDay(tasks).keys()].sort();
  if (!days.length) return { current: 0, longest: 0, lastActive: null };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    if (daysBetween(days[i - 1], days[i]) === 1) run++;
    else run = 1;
    if (run > longest) longest = run;
  }

  const today = todayKey();
  const last = days[days.length - 1];
  const gap = daysBetween(last, today);
  let current = 0;
  if (gap === 0 || gap === 1) {
    current = 1;
    for (let i = days.length - 1; i > 0; i--) {
      if (daysBetween(days[i - 1], days[i]) === 1) current++;
      else break;
    }
  }
  return { current, longest, lastActive: last };
}

/**
 * How the streak is doing, as a mood rather than a number.
 *
 *   none    never had one worth mentioning
 *   live    active today or yesterday
 *   broken  had a real run going, and it lapsed
 *
 * Only `broken` changes what the UI says, and only gently: it is what puts the
 * character in its `sad` pose when you come back. A single missed day after one
 * active day is not a lapse worth remarking on, so `longest` has to be at least
 * two before this reports broken — otherwise the app would commiserate with
 * someone who has barely started.
 */
export type StreakMood = 'none' | 'live' | 'broken';

export function streakMood(s: {
  current: number;
  longest: number;
  lastActive: DayKey | null;
}): StreakMood {
  if (s.current > 0) return 'live';
  if (!s.lastActive || s.longest < 2) return 'none';
  // A future-dated completion also lands here (current is 0). Treating that as
  // "none" rather than "broken" avoids commiserating over a data-entry quirk.
  return daysBetween(s.lastActive, todayKey()) > 1 ? 'broken' : 'none';
}

/**
 * Per-area counts, computed from the tasks themselves.
 *
 * Notion *does* expose rollups for this, but rollup values are eventually
 * consistent — right after a write they can still report the old number. The
 * dashboard and the analytics page would then disagree with each other. Both
 * now count the same in-memory task list, so they always agree.
 */
export function areaProgress(areas: Area[], tasks: Task[]) {
  const byArea = new Map<string, Task[]>();
  for (const t of tasks) {
    for (const id of t.areaIds) {
      const l = byArea.get(id);
      if (l) l.push(t);
      else byArea.set(id, [t]);
    }
  }
  return areas
    .map((area) => {
      const list = byArea.get(area.id) ?? [];
      const done = list.filter((t) => t.done).length;
      return {
        area,
        total: list.length,
        done,
        pct: list.length ? (done / list.length) * 100 : 0,
      };
    })
    .sort((a, b) => a.area.order - b.area.order);
}

/**
 * Weighted overall Job Switch progress.
 *
 *   overall = Σ(weight × done) / Σ(weight × total)
 *
 * With every weight at 1 this is simply "all tasks done / all tasks", so
 * DSA contributes automatically and proportionally. Bumping an area's Weight
 * makes it count for more without any code change.
 */
export function overallProgress(
  areas: Area[],
  tasks: Task[],
): { done: number; total: number; pct: number } {
  let wDone = 0;
  let wTotal = 0;
  let done = 0;
  let total = 0;
  for (const row of areaProgress(areas, tasks)) {
    if (row.area.status === 'Paused') continue;
    if (!row.total) continue;
    const w = row.area.weight || 1;
    wDone += w * row.done;
    wTotal += w * row.total;
    done += row.done;
    total += row.total;
  }
  return { done, total, pct: wTotal ? (wDone / wTotal) * 100 : 0 };
}

export function difficultyBreakdown(tasks: Task[]) {
  const rows = DIFFICULTY.map((d) => {
    const of = tasks.filter((t) => t.difficulty === d);
    return { difficulty: d as Difficulty, total: of.length, done: of.filter((t) => t.done).length };
  });
  const unset = tasks.filter((t) => !t.difficulty);
  return { rows, unset: { total: unset.length, done: unset.filter((t) => t.done).length } };
}

/** Per-topic progress, computed locally so it works even before rollups settle. */
export function topicProgress(topics: Topic[], tasks: Task[]) {
  const byTopic = new Map<string, Task[]>();
  for (const t of tasks) {
    for (const id of t.topicIds) {
      const l = byTopic.get(id);
      if (l) l.push(t);
      else byTopic.set(id, [t]);
    }
  }
  return topics
    .map((tp) => {
      const list = byTopic.get(tp.id) ?? [];
      const done = list.filter((t) => t.done).length;
      return { topic: tp, total: list.length, done, pct: list.length ? (done / list.length) * 100 : 0 };
    })
    .sort((a, b) => a.topic.order - b.topic.order);
}

/** Group a topic's tasks by their original heading, preserving sheet order. */
export function groupByHeading(tasks: Task[]) {
  const m = new Map<string, Task[]>();
  for (const t of [...tasks].sort((a, b) => a.order - b.order)) {
    const k = t.heading || '—';
    const l = m.get(k);
    if (l) l.push(t);
    else m.set(k, [t]);
  }
  return [...m.entries()].map(([heading, items]) => ({
    heading,
    items,
    total: items.length,
    done: items.filter((t) => t.done).length,
  }));
}

/** Daily completion counts for the last `days` days, oldest first. */
export function velocity(tasks: Task[], days = 30) {
  const counts = countsByDay(tasks);
  const today = todayKey();
  const out: { day: DayKey; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = shiftKey(today, -i);
    out.push({ day, count: counts.get(day) ?? 0 });
  }
  return out;
}

/** 7-day rolling average over a velocity series. */
export function rollingAverage(series: { day: DayKey; count: number }[], window = 7) {
  return series.map((pt, i) => {
    const from = Math.max(0, i - window + 1);
    const slice = series.slice(from, i + 1);
    return { day: pt.day, avg: slice.reduce((s, x) => s + x.count, 0) / slice.length };
  });
}

export function noteFor(notes: DailyNote[], day: DayKey): DailyNote | undefined {
  return notes.find((n) => n.date?.slice(0, 10) === day);
}

/** Summary stats for the dashboard hero row. */
export function summarize(areas: Area[], tasks: Task[]) {
  const overall = overallProgress(areas, tasks);
  const s = streaks(tasks);
  const today = todayKey();
  const counts = countsByDay(tasks);
  const last7 = Array.from({ length: 7 }, (_, i) => counts.get(shiftKey(today, -i)) ?? 0);
  const activeDays = counts.size;
  return {
    overall,
    streak: s,
    todayCount: counts.get(today) ?? 0,
    last7Total: last7.reduce((a, b) => a + b, 0),
    activeDays,
    perActiveDay: activeDays ? overall.done / activeDays : 0,
  };
}

/**
 * How it has actually been going lately, as one mood.
 *
 * `streakMood` above answers one narrow question — is there a live run — and
 * that was all the dashboard knew. It cannot see someone keeping a streak alive
 * on one question a day after a fortnight of five, and it cannot tell "never
 * started" from "stopped".
 *
 * Everything here is composed from what this module already derives (streaks,
 * summarize, velocity, rollingAverage). There is deliberately no invented
 * "questions per day target": the app has never asked anyone for one, so the
 * only honest yardstick for a slowdown is a person's own earlier pace.
 */

/**
 * The slowdown window.
 *
 * Three days is the shortest stretch that is not simply one bad Tuesday, and
 * the seven before it are the same window the velocity chart's rolling average
 * uses — so the dashboard and the chart are measuring the same thing rather
 * than two things that happen to disagree.
 */
export const SLOWDOWN_RECENT_DAYS = 3;
export const SLOWDOWN_BASELINE_DAYS = 7;

/**
 * How far the pace has to fall before it is worth remarking on: to 40% of the
 * earlier average, i.e. rather more than halved. Ordinary week-to-week wobble
 * does not reach that, and neither does one quiet day inside a good week —
 * the recent window is three days wide, so it takes a real stretch.
 */
export const SLOWDOWN_RATIO = 0.4;

/**
 * A floor under the baseline, for the same reason `streakMood` refuses to
 * report broken below a two-day longest: you cannot slow down from a pace you
 * never had. One question a day, sustained across the baseline week, is the
 * least that counts as a pace at all.
 */
export const SLOWDOWN_MIN_BASELINE = 1;

/**
 * True when recent output has fallen well below this person's own earlier pace.
 *
 * Measured through `velocity` and `rollingAverage` rather than a fresh counting
 * pass, so it cannot drift away from what the analytics chart draws.
 */
function hasSlowedDown(tasks: Task[]): boolean {
  const series = velocity(tasks, SLOWDOWN_RECENT_DAYS + SLOWDOWN_BASELINE_DAYS);
  const recentPerDay =
    series.slice(-SLOWDOWN_RECENT_DAYS).reduce((sum, pt) => sum + pt.count, 0) /
    SLOWDOWN_RECENT_DAYS;
  // The rolling average as it stood the day before the recent window opened:
  // the pace that has been left behind, rather than one that already includes
  // the drop and therefore partly hides it.
  const baseline = rollingAverage(series, SLOWDOWN_BASELINE_DAYS)[
    series.length - SLOWDOWN_RECENT_DAYS - 1
  ].avg;
  if (baseline < SLOWDOWN_MIN_BASELINE) return false;
  return recentPerDay <= baseline * SLOWDOWN_RATIO;
}

/** What `summarize` hands back, named so callers can pass it around. */
export type Summary = ReturnType<typeof summarize>;

export type MoodKey = 'strong' | 'steady' | 'slipping';
export type MoodCause = 'today' | 'live' | 'streak-broken' | 'slowing' | 'none';

export type PerformanceMood = {
  key: MoodKey;
  cause: MoodCause;
  /** Days since the last completed question; null when there has never been one. */
  daysSinceActive: number | null;
};

/**
 * The mood, and the one fact behind it.
 *
 * Takes the same `stats` object the hero is rendered from, rather than deriving
 * its own: the banner sits directly under the hero, and two independent counts
 * of the same thing is exactly how they would end up contradicting each other.
 */
export function performanceMood(tasks: Task[], stats: Summary): PerformanceMood {
  const streak = streakMood(stats.streak);
  const daysSinceActive = stats.streak.lastActive
    ? Math.max(0, daysBetween(stats.streak.lastActive, todayKey()))
    : null;
  const base = { daysSinceActive };

  // Anything logged today settles it. Whatever the last fortnight looked like,
  // the thing we would have asked for has already happened — and telling
  // someone who just ticked a question off that they have slowed down is
  // precisely the nagging this is meant to avoid.
  if (streak === 'live' && stats.todayCount > 0) {
    return { key: 'strong', cause: 'today', ...base };
  }

  // A lapsed run is the more concrete thing to name, so it wins when both are
  // true — "nothing for five days" is more useful than "you have slowed down".
  if (streak === 'broken') return { key: 'slipping', cause: 'streak-broken', ...base };
  if (hasSlowedDown(tasks)) return { key: 'slipping', cause: 'slowing', ...base };
  if (streak === 'live') return { key: 'steady', cause: 'live', ...base };
  // Everything else is neutral, including someone who has never logged
  // anything: there is no pace to have fallen from and nothing to commiserate
  // about, so the app should get out of the way. `daysSinceActive` is null in
  // that case, which is how a caller tells "never started" from "stopped"
  // without a fourth mood that would render identically to this one.
  return { key: 'steady', cause: 'none', ...base };
}
