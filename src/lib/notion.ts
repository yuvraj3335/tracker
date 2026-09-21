import { Client } from '@notionhq/client';
import { env, isConfigured } from './env';
import { demoData, isDemo } from './demo';
import { P, type Difficulty } from './schema';
import { dayKeyOf, type DayKey } from './date';

/* eslint-disable @typescript-eslint/no-explicit-any */

let _client: Client | null = null;
export function notion(): Client {
  if (!env.notionToken) throw new Error('NOTION_TOKEN is not set');
  if (!_client) _client = new Client({ auth: env.notionToken });
  return _client;
}

// ---------------------------------------------------------------------------
// Property extraction — Notion's response unions are unwieldy, so read
// defensively and always return a usable value.
// ---------------------------------------------------------------------------
const rt = (p: any): string =>
  (p?.rich_text ?? []).map((t: any) => t?.plain_text ?? '').join('').trim();
const tt = (p: any): string =>
  (p?.title ?? []).map((t: any) => t?.plain_text ?? '').join('').trim();
const nm = (p: any): number | null => (typeof p?.number === 'number' ? p.number : null);
const cb = (p: any): boolean => p?.checkbox === true;
const sel = (p: any): string | null => p?.select?.name ?? null;
const dt = (p: any): string | null => p?.date?.start ?? null;
const ur = (p: any): string => (typeof p?.url === 'string' ? p.url : '');
const rel = (p: any): string[] => (p?.relation ?? []).map((r: any) => r.id);
const roll = (p: any): number | null => {
  const r = p?.rollup;
  if (!r) return null;
  if (typeof r.number === 'number') return r.number;
  return null;
};

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------
export type Area = {
  id: string;
  name: string;
  slug: string;
  emoji: string;
  weight: number;
  status: string;
  order: number;
  total: number | null;
  done: number | null;
  progress: number | null;
};

export type Topic = {
  id: string;
  name: string;
  order: number;
  path: string;
  areaIds: string[];
  total: number | null;
  done: number | null;
  progress: number | null;
};

export type Task = {
  id: string;
  name: string;
  done: boolean;
  completedOn: DayKey | null;
  areaIds: string[];
  topicIds: string[];
  heading: string;
  difficulty: Difficulty | null;
  order: number;
  headingOrder: number;
  taskOrder: number;
  links: { tuf: string; leetcode: string; gfg: string; youtube: string };
  bookmarked: boolean;
  revisit: boolean;
  notes: string;
  sourceId: string;
};

export type DailyNote = {
  id: string;
  date: DayKey | null;
  note: string;
  hours: number | null;
  mood: string | null;
};

// ---------------------------------------------------------------------------
// A tiny TTL cache. Notion is rate-limited (~3 req/s) and the task table needs
// 5 paginated calls, so re-fetching per request would make the dashboard crawl.
// Mutations call invalidate() so a toggle shows up immediately.
// ---------------------------------------------------------------------------
type Entry = { value: unknown; at: number };
const store = new Map<string, Entry>();
const TTL_MS = 60_000;

export function invalidate(prefix?: string) {
  if (!prefix) return store.clear();
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await fn();
  store.set(key, { value, at: Date.now() });
  return value;
}

/** Walk every page of a data source query. */
async function queryAll(dataSourceId: string, body: Record<string, unknown> = {}) {
  const out: any[] = [];
  let cursor: string | undefined;
  do {
    const res: any = await notion().dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      start_cursor: cursor,
      ...body,
    } as any);
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export async function getAreas(): Promise<Area[]> {
  if (isDemo()) return demoData().areas;
  if (!isConfigured()) return [];
  return cached('areas', async () => {
    const rows = await queryAll(env.areasDs!, {
      sorts: [{ property: P.area.order, direction: 'ascending' }],
    });
    return rows.map((r) => {
      const p = r.properties;
      return {
        id: r.id,
        name: tt(p[P.area.name]),
        slug: rt(p[P.area.slug]),
        emoji: rt(p[P.area.emoji]),
        weight: nm(p[P.area.weight]) ?? 1,
        status: sel(p[P.area.status]) ?? 'Active',
        order: nm(p[P.area.order]) ?? 0,
        total: roll(p[P.area.totalTasks]),
        done: roll(p[P.area.doneTasks]),
        progress: roll(p[P.area.progress]),
      } satisfies Area;
    });
  });
}

export async function getTopics(): Promise<Topic[]> {
  if (isDemo()) return demoData().topics;
  if (!isConfigured()) return [];
  return cached('topics', async () => {
    const rows = await queryAll(env.topicsDs!, {
      sorts: [{ property: P.topic.order, direction: 'ascending' }],
    });
    return rows.map((r) => {
      const p = r.properties;
      return {
        id: r.id,
        name: tt(p[P.topic.name]),
        order: nm(p[P.topic.order]) ?? 0,
        path: rt(p[P.topic.path]),
        areaIds: rel(p[P.topic.area]),
        total: roll(p[P.topic.totalTasks]),
        done: roll(p[P.topic.doneTasks]),
        progress: roll(p[P.topic.progress]),
      } satisfies Topic;
    });
  });
}

export async function getTasks(): Promise<Task[]> {
  if (isDemo()) return demoData().tasks;
  if (!isConfigured()) return [];
  return cached('tasks', async () => {
    const rows = await queryAll(env.tasksDs!, {
      sorts: [{ property: P.task.order, direction: 'ascending' }],
    });
    return rows.map((r) => {
      const p = r.properties;
      return {
        id: r.id,
        name: tt(p[P.task.name]),
        done: cb(p[P.task.done]),
        completedOn: dt(p[P.task.completedOn]),
        areaIds: rel(p[P.task.area]),
        topicIds: rel(p[P.task.topic]),
        heading: sel(p[P.task.heading]) ?? '',
        difficulty: (sel(p[P.task.difficulty]) as Difficulty | null) ?? null,
        order: nm(p[P.task.order]) ?? 0,
        headingOrder: nm(p[P.task.headingOrder]) ?? 0,
        taskOrder: nm(p[P.task.taskOrder]) ?? 0,
        links: {
          tuf: ur(p[P.task.tuf]),
          leetcode: ur(p[P.task.leetcode]),
          gfg: ur(p[P.task.gfg]),
          youtube: ur(p[P.task.youtube]),
        },
        bookmarked: cb(p[P.task.bookmarked]),
        revisit: cb(p[P.task.revisit]),
        notes: rt(p[P.task.notes]),
        sourceId: rt(p[P.task.sourceId]),
      } satisfies Task;
    });
  });
}

export async function getDailyNotes(): Promise<DailyNote[]> {
  if (isDemo()) return [];
  if (!env.dailyDs || !env.notionToken) return [];
  return cached('daily', async () => {
    const rows = await queryAll(env.dailyDs!);
    return rows.map((r) => {
      const p = r.properties;
      return {
        id: r.id,
        date: dt(p[P.daily.date]),
        note: rt(p[P.daily.note]),
        hours: nm(p[P.daily.hours]),
        mood: sel(p[P.daily.mood]),
      } satisfies DailyNote;
    });
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Toggling `Done` is the system's single input. Setting it also stamps
 * `Completed On`, which is what feeds the Daily Tracker and the heatmap —
 * so there is never a second thing to log. Clearing it removes the stamp.
 */
export async function setTaskDone(taskId: string, done: boolean, day?: DayKey) {
  if (isDemo()) return;
  const properties: any = {
    [P.task.done]: { checkbox: done },
    [P.task.completedOn]: done ? { date: { start: day ?? dayKeyOf(new Date()) } } : { date: null },
  };
  await notion().pages.update({ page_id: taskId, properties });
  invalidate();
}

export async function setTaskFlag(
  taskId: string,
  flag: 'bookmarked' | 'revisit',
  value: boolean,
) {
  if (isDemo()) return;
  const key = flag === 'bookmarked' ? P.task.bookmarked : P.task.revisit;
  await notion().pages.update({
    page_id: taskId,
    properties: { [key]: { checkbox: value } } as any,
  });
  invalidate();
}

export async function setTaskDifficulty(taskId: string, difficulty: Difficulty | null) {
  if (isDemo()) return;
  await notion().pages.update({
    page_id: taskId,
    properties: {
      [P.task.difficulty]: difficulty ? { select: { name: difficulty } } : { select: null },
    } as any,
  });
  invalidate();
}
