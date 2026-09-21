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
