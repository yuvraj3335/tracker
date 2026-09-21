/**
 * Sets up a user's Notion workspace, in resumable chunks.
 *
 * Seeding 456 questions means 456 individual page creations — Notion has no
 * bulk insert and allows roughly 3 requests/second, so the whole job takes
 * minutes. That is far longer than a serverless function may run, so it is
 * split into small chunks driven by the browser: each request creates a handful
 * of rows, records how far it got, and returns progress.
 *
 * Every step is idempotent. `provisionCursor` is an index into one flat,
 * deterministically ordered list of questions, so a retried or interrupted
 * chunk resumes exactly where it stopped without duplicating anything.
 */
import { Client } from '@notionhq/client';
import seedJson from '../../data/a2z-seed.json';
import {
  P,
  areasProperties,
  topicsProperties,
  tasksProperties,
  areaRollups,
  topicRollups,
  dailyProperties,
} from './schema';

/* eslint-disable @typescript-eslint/no-explicit-any */

type SeedQuestion = {
  order: number;
  name: string;
  tufLink: string;
  leetCodeLink: string;
  gfgLink: string;
  youTubeLink: string;
  sourceId: string;
  globalOrder: number;
};
type SeedHeading = { order: number; name: string; questions: SeedQuestion[] };
type SeedSection = { order: number; name: string; path: string; headings: SeedHeading[] };

const SEED = seedJson as unknown as {
  totals: { sections: number; headings: number; questions: number };
  sections: SeedSection[];
};

/** One flat list in sheet order. The provisioning cursor indexes into this. */
export type FlatQuestion = SeedQuestion & {
  sectionPath: string;
  sectionOrder: number;
  headingName: string;
  headingOrder: number;
};

let _flat: FlatQuestion[] | null = null;
export function flatQuestions(): FlatQuestion[] {
  if (_flat) return _flat;
  const out: FlatQuestion[] = [];
  for (const s of SEED.sections) {
    for (const h of s.headings) {
      for (const q of h.questions) {
        out.push({
          ...q,
          sectionPath: s.path,
          sectionOrder: s.order,
          headingName: h.name,
          headingOrder: h.order,
        });
      }
    }
  }
  // Sort by the scraper's global order so the cursor is stable across deploys.
  out.sort((a, b) => a.globalOrder - b.globalOrder);
  _flat = out;
  return out;
}

export const TOTAL_QUESTIONS = SEED.totals.questions;

export function uniqueHeadings(): string[] {
  return [...new Set(SEED.sections.flatMap((s) => s.headings.map((h) => h.name)))];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const rtv = (s: string) => [{ type: 'text' as const, text: { content: s } }];
const urlOrNull = (v: string) => ({ url: v && v.trim() ? v.trim() : null });

/** Accepts a full Notion URL or a bare id and returns a dashed uuid. */
export function normalizeNotionId(raw: string): string {
  const matches = raw.trim().replace(/-/g, '').match(/[0-9a-fA-F]{32}(?![0-9a-fA-F])/g);
  if (!matches?.length) {
    throw new Error(
      'That does not look like a Notion page link. Open the page, use Share → Copy link, and paste the whole URL.',
    );
  }
  const h = matches[matches.length - 1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Throttle so a burst of writes stays inside Notion's ~3 req/s budget. */
const GAP_MS = 340;
let lastCall = 0;
async function throttle() {
  const wait = GAP_MS - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

async function call<T>(label: string, fn: () => Promise<T>, attempt = 1): Promise<T> {
  await throttle();
  try {
    return await fn();
  } catch (e) {
    const status = (e as any)?.status;
    if ((status === 429 || status === 502 || status === 503 || status === 504) && attempt <= 4) {
      await new Promise((r) => setTimeout(r, (status === 429 ? 1200 : 600) * attempt));
      return call(label, fn, attempt + 1);
    }
    throw new Error(`${label}: ${friendlyNotionError(e)}`);
  }
}

/** Turns Notion's API errors into something a user can act on. */
export function friendlyNotionError(e: unknown): string {
  const err = e as any;
  const code = err?.code;
  const status = err?.status;
  const msg = String(err?.message ?? err ?? 'unknown error');

  if (code === 'unauthorized' || status === 401) {
    return 'Notion rejected that token. Check you copied the full secret from your integration.';
  }
  if (code === 'object_not_found' || status === 404) {
    return 'Notion cannot see that page. Open it, click the ••• menu → Connections, and add your integration.';
  }
  if (code === 'restricted_resource' || status === 403) {
    return 'That integration does not have permission for this page. Add it under the page’s Connections menu.';
  }
  if (code === 'validation_error') return `Notion rejected the request: ${msg}`;
  if (status === 429) return 'Notion is rate-limiting the request. Wait a moment and retry.';
  return msg;
}

// ---------------------------------------------------------------------------
// Step 1 — validate the token
// ---------------------------------------------------------------------------
export async function validateToken(token: string): Promise<{ name: string }> {
  const client = new Client({ auth: token });
  const me: any = await client.users.me({});
  return { name: me?.name ?? me?.bot?.owner?.user?.name ?? 'your workspace' };
}

// ---------------------------------------------------------------------------
// Step 2 — create the four databases, their rollups and their views
// ---------------------------------------------------------------------------
export type CreatedDatabases = {
  parentPageId: string;
  areasDs: string;
  topicsDs: string;
  tasksDs: string;
  dailyDs: string;
  areaPageId: string;
  topicPageIds: Record<string, string>;
  /** False when the comma fallback made Heading a rich_text instead of a select. */
  headingIsSelect: boolean;
};

async function createDb(
  client: Client,
  parentPageId: string,
  name: string,
  emoji: string,
  properties: Record<string, any>,
): Promise<string> {
  const res: any = await call(`create "${name}"`, () =>
    client.databases.create({
      parent: { type: 'page_id', page_id: parentPageId },
      title: rtv(name),
      icon: { type: 'emoji', emoji } as any,
      initial_data_source: { properties },
    } as any),
  );
  const ds = res.data_sources?.[0]?.id;
  if (!ds) throw new Error(`Notion created "${name}" but returned no data source`);
  return ds;
}

async function propertyIds(client: Client, ds: string): Promise<Record<string, string>> {
  const res: any = await call('read schema', () =>
    client.dataSources.retrieve({ data_source_id: ds } as any),
  );
  const out: Record<string, string> = {};
  for (const [name, cfg] of Object.entries<any>(res.properties ?? {})) out[name] = cfg.id;
  return out;
}

export async function createDatabases(
  token: string,
  parentPageRaw: string,
): Promise<CreatedDatabases> {
  const client = new Client({ auth: token });
  const parentPageId = normalizeNotionId(parentPageRaw);

  // Fail early with a clear message if the integration cannot see the page,
  // rather than half-creating databases.
  await call('open parent page', () => client.pages.retrieve({ page_id: parentPageId }));

  const areasDs = await createDb(client, parentPageId, 'Areas', '🎯', areasProperties());
  const topicsDs = await createDb(
    client,
    parentPageId,
    'Topics',
    '📚',
    topicsProperties(areasDs),
  );

  // Heading is a select so Notion can group by it. Notion has historically
  // rejected commas in option names, so fall back to rich_text rather than
  // ever altering a heading from the source sheet.
  const headings = uniqueHeadings();
  let tasksDs: string;
  let headingSelect = true;
  try {
    tasksDs = await createDb(
      client,
      parentPageId,
      'Tasks',
      '✅',
      tasksProperties(areasDs, topicsDs, headings, true),
    );
  } catch {
    headingSelect = false;
    tasksDs = await createDb(
      client,
      parentPageId,
      'Tasks',
      '✅',
      tasksProperties(areasDs, topicsDs, headings, false),
    );
  }

  const dailyDs = await createDb(client, parentPageId, 'Daily Notes', '📝', dailyProperties());

  // Rollups can only be added once the dual relations exist on Areas/Topics.
  await call('add Areas rollups', () =>
    client.dataSources.update({ data_source_id: areasDs, properties: areaRollups() } as any),
  );
  await call('add Topics rollups', () =>
    client.dataSources.update({ data_source_id: topicsDs, properties: topicRollups() } as any),
  );

  // Area + topics are few enough to create in this same step.
  const areaRes: any = await call('create DSA area', () =>
    client.pages.create({
      parent: { type: 'data_source_id', data_source_id: areasDs },
      icon: { type: 'emoji', emoji: '🧩' } as any,
      properties: {
        [P.area.name]: { title: rtv('DSA') },
        [P.area.slug]: { rich_text: rtv('dsa') },
        [P.area.emoji]: { rich_text: rtv('🧩') },
        [P.area.weight]: { number: 1 },
        [P.area.status]: { select: { name: 'Active' } },
        [P.area.order]: { number: 0 },
      } as any,
    } as any),
  );
  const areaPageId: string = areaRes.id;

  const topicPageIds: Record<string, string> = {};
  for (const s of SEED.sections) {
    const res: any = await call(`create topic ${s.name}`, () =>
      client.pages.create({
        parent: { type: 'data_source_id', data_source_id: topicsDs },
        properties: {
          [P.topic.name]: { title: rtv(s.name) },
          [P.topic.order]: { number: s.order },
          [P.topic.path]: { rich_text: rtv(s.path) },
          [P.topic.area]: { relation: [{ id: areaPageId }] },
        } as any,
      } as any),
    );
    topicPageIds[s.path] = res.id;
  }

  await buildViews(client, { areasDs, topicsDs, tasksDs, dailyDs });

  return {
    parentPageId,
    areasDs,
    topicsDs,
    tasksDs,
    dailyDs,
    areaPageId,
    topicPageIds,
    headingIsSelect: headingSelect,
  };
}

/** Ready-made Notion views. A failure here is cosmetic and never fatal. */
async function buildViews(
  client: Client,
  ds: { areasDs: string; topicsDs: string; tasksDs: string; dailyDs: string },
) {
  const safe = async (label: string, body: Record<string, any>) => {
    try {
      await call(`view ${label}`, () => (client as any).views.create(body));
    } catch {
      /* views are a nicety; never block provisioning on one */
    }
  };

  const taskP = await propertyIds(client, ds.tasksDs).catch(() => ({}) as Record<string, string>);
  const dailyP = await propertyIds(client, ds.dailyDs).catch(() => ({}) as Record<string, string>);

  // The Daily Tracker: a calendar keyed on Completed On. Ticking a question
  // places it on that day automatically — this IS the look-back view.
  if (taskP[P.task.completedOn]) {
    await safe('Daily Tracker', {
      data_source_id: ds.tasksDs,
      name: 'Daily Tracker',
      type: 'calendar',
      configuration: {
        type: 'calendar',
        date_property_id: taskP[P.task.completedOn],
        view_range: 'month',
        show_weekends: true,
      },
    });
  }
  await safe('Done Log', {
    data_source_id: ds.tasksDs,
    name: 'Done Log',
    type: 'table',
    filter: { property: P.task.done, checkbox: { equals: true } },
    sorts: [{ property: P.task.completedOn, direction: 'descending' }],
  });
  await safe('Bookmarked', {
    data_source_id: ds.tasksDs,
    name: 'Bookmarked',
    type: 'table',
    filter: { property: P.task.bookmarked, checkbox: { equals: true } },
  });
  await safe('Revisit', {
    data_source_id: ds.tasksDs,
    name: 'Revisit',
    type: 'table',
    filter: { property: P.task.revisit, checkbox: { equals: true } },
  });
  await safe('Topic Progress', {
    data_source_id: ds.topicsDs,
    name: 'Progress',
    type: 'table',
    sorts: [{ property: P.topic.order, direction: 'ascending' }],
  });
  if (dailyP[P.daily.date]) {
    await safe('Journal', {
      data_source_id: ds.dailyDs,
      name: 'Journal',
      type: 'calendar',
      configuration: {
        type: 'calendar',
        date_property_id: dailyP[P.daily.date],
        view_range: 'month',
        show_weekends: true,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Step 3 — seed the questions, a chunk at a time
// ---------------------------------------------------------------------------

/**
 * Small enough that a chunk finishes well inside a serverless timeout:
 * 15 writes at ~340ms is a little over five seconds.
 */
export const CHUNK_SIZE = 15;

export async function seedChunk(
  token: string,
  d: {
    tasksDs: string;
    areaPageId: string;
    topicPageIds: Record<string, string>;
    headingIsSelect: boolean;
  },
  cursor: number,
  size: number = CHUNK_SIZE,
): Promise<{ cursor: number; total: number; done: boolean }> {
  const client = new Client({ auth: token });
  const all = flatQuestions();
  const end = Math.min(cursor + size, all.length);

  for (let i = cursor; i < end; i++) {
    const q = all[i];
    const topicId = d.topicPageIds[q.sectionPath];
    if (!topicId) throw new Error(`no Notion topic for section "${q.sectionPath}"`);

    await call(`create "${q.name.slice(0, 40)}"`, () =>
      client.pages.create({
        parent: { type: 'data_source_id', data_source_id: d.tasksDs },
        properties: {
          [P.task.name]: { title: rtv(q.name) },
          [P.task.done]: { checkbox: false },
          [P.task.area]: { relation: [{ id: d.areaPageId }] },
          [P.task.topic]: { relation: [{ id: topicId }] },
          [P.task.heading]: d.headingIsSelect
            ? { select: { name: q.headingName } }
            : { rich_text: rtv(q.headingName) },
          // Difficulty is intentionally omitted — the source sheet has none.
          [P.task.order]: { number: q.globalOrder },
          [P.task.headingOrder]: { number: q.headingOrder },
          [P.task.taskOrder]: { number: q.order },
          [P.task.tuf]: urlOrNull(q.tufLink),
          [P.task.leetcode]: urlOrNull(q.leetCodeLink),
          [P.task.gfg]: urlOrNull(q.gfgLink),
          [P.task.youtube]: urlOrNull(q.youTubeLink),
          [P.task.bookmarked]: { checkbox: false },
          [P.task.revisit]: { checkbox: false },
          [P.task.sourceId]: {
            rich_text: rtv(`${q.sectionPath}|${q.headingOrder}|${q.order}|${q.sourceId}`),
          },
        } as any,
      } as any),
    );
  }

  return { cursor: end, total: all.length, done: end >= all.length };
}

/** Reads back whether Heading ended up a select or rich_text. */
export async function headingIsSelect(token: string, tasksDs: string): Promise<boolean> {
  const client = new Client({ auth: token });
  const res: any = await call('read Tasks schema', () =>
    client.dataSources.retrieve({ data_source_id: tasksDs } as any),
  );
  return (res.properties?.[P.task.heading]?.type ?? 'select') === 'select';
}

/** Counts rows actually present, for verifying a finished seed. */
export async function countTasks(token: string, tasksDs: string): Promise<number> {
  const client = new Client({ auth: token });
  let total = 0;
  let cursor: string | undefined;
  let guard = 0;
  do {
    const res: any = await call('count tasks', () =>
      client.dataSources.query({
        data_source_id: tasksDs,
        page_size: 100,
        start_cursor: cursor,
      } as any),
    );
    total += res.results.length;
    cursor = res.has_more ? res.next_cursor : undefined;
    if (++guard > 100) break;
  } while (cursor);
  return total;
}
