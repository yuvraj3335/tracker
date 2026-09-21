import { Client } from '@notionhq/client';
import { P, type Difficulty } from './schema';
import { dayKeyOf, type DayKey } from './date';
import type { Tenant } from './tenant';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * One client per token, cached by token so repeated requests for the same user
 * reuse it. Deliberately NOT a single module-level client: that would bind the
 * first caller's token for the lifetime of the server process and serve their
 * Notion data to everyone else.
 */
const clients = new Map<string, Client>();
export function notionFor(token: string): Client {
  let c = clients.get(token);
  if (!c) {
    c = new Client({ auth: token });
    clients.set(token, c);
    // Unbounded growth would be a slow leak with many users; a few hundred
    // clients is harmless, so trim oldest-first past that.
    if (clients.size > 200) clients.delete(clients.keys().next().value!);
  }
  return c;
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
};

export type Topic = {
  id: string;
  name: string;
  order: number;
  path: string;
  areaIds: string[];
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
// Per-tenant TTL cache.
//
// Notion allows roughly 3 requests/second and a full task table needs 5
// paginated calls, so re-fetching on every request would make the dashboard
// crawl. Keys are prefixed with the user id: a cache shared across tenants
// would hand one user another's questions.
// ---------------------------------------------------------------------------
type Entry = { value: unknown; at: number };
const store = new Map<string, Entry>();
const TTL_MS = 60_000;
const MAX_ENTRIES = 400;

export function invalidateTenant(userId: string) {
  for (const k of [...store.keys()]) if (k.startsWith(`${userId}:`)) store.delete(k);
}

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await fn();
  if (store.size >= MAX_ENTRIES) {
    // Drop anything already stale before falling back to oldest-first.
    const now = Date.now();
    for (const [k, v] of store) if (now - v.at >= TTL_MS) store.delete(k);
    if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value!);
  }
  store.set(key, { value, at: Date.now() });
  return value;
}

/** Walks every page of a data source query. */
async function queryAll(client: Client, dataSourceId: string, body: Record<string, unknown> = {}) {
  const out: any[] = [];
  let cursor: string | undefined;
  let guard = 0;
  do {
    const res: any = await client.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      start_cursor: cursor,
      ...body,
    } as any);
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
    // A malformed cursor loop would otherwise spin forever; 100 pages is
    // 10,000 rows, far beyond any realistic sheet.
    if (++guard > 100) break;
  } while (cursor);
  return out;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export async function getAreas(t: Tenant): Promise<Area[]> {
  return cached(`${t.userId}:areas`, async () => {
    const rows = await queryAll(notionFor(t.token), t.areasDs, {
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
      } satisfies Area;
    });
  });
}

export async function getTopics(t: Tenant): Promise<Topic[]> {
  return cached(`${t.userId}:topics`, async () => {
    const rows = await queryAll(notionFor(t.token), t.topicsDs, {
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
      } satisfies Topic;
    });
  });
}

export async function getTasks(t: Tenant): Promise<Task[]> {
  return cached(`${t.userId}:tasks`, async () => {
    const rows = await queryAll(notionFor(t.token), t.tasksDs, {
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
        // Heading is a select normally, rich_text when the comma fallback fired.
        heading: sel(p[P.task.heading]) ?? rt(p[P.task.heading]),
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

export async function getDailyNotes(t: Tenant): Promise<DailyNote[]> {
  if (!t.dailyDs) return [];
  return cached(`${t.userId}:daily`, async () => {
    const rows = await queryAll(notionFor(t.token), t.dailyDs!);
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

/** Fetches the three tables a page needs, in parallel. */
export async function getEverything(t: Tenant) {
  const [areas, topics, tasks] = await Promise.all([getAreas(t), getTopics(t), getTasks(t)]);
  return { areas, topics, tasks };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/*
 * Note on authorisation for the writes below.
 *
 * Page ids arrive from the browser, so it is worth being explicit about what
 * stops one tenant writing to another's data: the token. Every write goes
 * through `notionFor(t.token)`, and that token is resolved server-side from
 * the session cookie and is scoped to that user's own Notion workspace. A
 * forged page id therefore cannot reach anyone else's rows — Notion answers
 * 404 — and at worst a user could target another page in a workspace they
 * already control.
 *
 * An earlier version also fetched each page first to confirm its parent. That
 * added a full round trip to every tick, the hottest interaction in the app,
 * while its fallback ("does the page have a Source Id property?") passed for
 * almost anything. It bought no isolation the token does not already provide,
 * so it was removed.
 */

/**
 * Ticking a question is the system's single input. Setting `Done` also stamps
 * `Completed On`, which is what feeds the Daily Tracker and the heatmap — so
 * there is never a second thing to log. Clearing it removes the stamp.
 */
export async function setTaskDone(t: Tenant, taskId: string, done: boolean, day?: DayKey) {
  await notionFor(t.token).pages.update({
    page_id: taskId,
    properties: {
      [P.task.done]: { checkbox: done },
      [P.task.completedOn]: done
        ? { date: { start: day ?? dayKeyOf(new Date()) } }
        : { date: null },
    } as any,
  });
  invalidateTenant(t.userId);
}

export async function setTaskFlag(
  t: Tenant,
  taskId: string,
  flag: 'bookmarked' | 'revisit',
  value: boolean,
) {
  const key = flag === 'bookmarked' ? P.task.bookmarked : P.task.revisit;
  await notionFor(t.token).pages.update({
    page_id: taskId,
    properties: { [key]: { checkbox: value } } as any,
  });
  invalidateTenant(t.userId);
}

export async function setTaskDifficulty(
  t: Tenant,
  taskId: string,
  difficulty: Difficulty | null,
) {
  await notionFor(t.token).pages.update({
    page_id: taskId,
    properties: {
      [P.task.difficulty]: difficulty ? { select: { name: difficulty } } : { select: null },
    } as any,
  });
  invalidateTenant(t.userId);
}
