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

/**
 * Throttle so a burst of writes stays inside Notion's ~3 req/s budget.
 *
 * Keyed per token, because Notion rate-limits per integration. A single shared
 * timestamp made one user's seeding slow down every other user's on the same
 * server instance, for no benefit — their quotas are separate.
 *
 * The queue is a promise chain rather than a bare timestamp: two concurrent
 * calls reading the same timestamp would both wait the same interval and then
 * fire together, which is not a throttle at all.
 */
const GAP_MS = 340;
const queues = new Map<string, Promise<void>>();

function throttle(key: string): Promise<void> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(() => new Promise<void>((r) => setTimeout(r, GAP_MS)));
  // Never let a rejection poison the chain for later calls.
  queues.set(
    key,
    next.catch(() => undefined),
  );
  if (queues.size > 200) {
    const oldest = queues.keys().next().value;
    if (oldest !== undefined && oldest !== key) queues.delete(oldest);
  }
  return previous;
}

/** A short, non-secret fingerprint so tokens are not used as map keys. */
function tokenKey(token: string): string {
  let h = 0;
  for (let i = 0; i < token.length; i++) h = (Math.imul(31, h) + token.charCodeAt(i)) | 0;
  return String(h);
}

type Caller = <T>(label: string, fn: () => Promise<T>) => Promise<T>;

/** Binds the throttle queue for one integration token. */
function callerFor(token: string): Caller {
  const key = tokenKey(token);
  return (label, fn) => call(label, fn, 1, key);
}

async function call<T>(
  label: string,
  fn: () => Promise<T>,
  attempt = 1,
  key = 'default',
): Promise<T> {
  await throttle(key);
  try {
    return await fn();
  } catch (e) {
    const status = (e as any)?.status;
    if ((status === 429 || status === 502 || status === 503 || status === 504) && attempt <= 4) {
      await new Promise((r) => setTimeout(r, (status === 429 ? 1200 : 600) * attempt));
      return call(label, fn, attempt + 1, key);
    }
    console.error(`[notion] ${label} failed:`, (e as any)?.message ?? e);
    // `label` stays out of the message: it names an internal step.
    throw wrapNotionError(e);
  }
}

/**
 * True only for Notion rejecting a select option — the one failure the
 * rich_text fallback is meant to handle. Notion has historically refused
 * commas in option names, and one heading in the sheet contains them.
 */
export function isSelectOptionRejection(e: unknown): boolean {
  // Judge Notion's own error, not our wrapper: the wrapper's message is the
  // friendly copy, which never mentions select options. Reading the wrapper is
  // exactly how this fallback stopped firing and setup died on "Tasks".
  const err = (e as any)?.cause ?? e;
  if (err?.code !== 'validation_error' && err?.status !== 400) return false;
  return /select|option|comma/i.test(String(err?.message ?? ''));
}

type WrappedNotionError = Error & { code?: unknown; status?: unknown; friendly: true };

/**
 * The error `call` throws: friendly copy as the message, Notion's original
 * error as `cause`.
 *
 * The code and status are copied up so friendlyNotionError can still classify
 * it — without them a rate-limited write reached the user as the generic
 * fallback instead of "Notion is busy". The original stays on `cause` because
 * some callers must decide from what Notion actually said (see
 * isSelectOptionRejection), and the friendly copy has thrown that away.
 */
export function wrapNotionError(e: unknown): WrappedNotionError {
  const wrapped = new Error(friendlyNotionError(e), { cause: e }) as WrappedNotionError;
  wrapped.code = (e as any)?.code;
  wrapped.status = (e as any)?.status;
  wrapped.friendly = true;
  return wrapped;
}

/**
 * Turns a Notion API error into something the person can act on.
 *
 * Every branch returns copy written for the person who has to fix it. The raw
 * API text is deliberately never returned: it names internal mechanics, it is
 * written for whoever is integrating rather than whoever is signing up, and the
 * two fallbacks here used to hand it straight to the screen. It is logged
 * instead, where it is actually useful.
 */
export function friendlyNotionError(e: unknown): string {
  const err = e as any;
  // Already translated (and already logged) by wrapNotionError.
  if (err?.friendly === true && typeof err.message === 'string') return err.message;
  const code = err?.code;
  const status = err?.status;
  const raw = String(err?.message ?? err ?? 'unknown error');

  if (code === 'unauthorized' || status === 401) {
    return 'Notion did not accept that secret. Check you copied the whole thing, then try again.';
  }
  if (code === 'object_not_found' || status === 404) {
    return 'Notion cannot reach that page. Open it, choose ••• → Connections, and add your integration.';
  }
  if (code === 'restricted_resource' || status === 403) {
    return 'Your integration does not have access to that page. Add it under the page’s Connections menu.';
  }
  if (status === 429) {
    return 'Notion is busy right now. Wait a few seconds, then continue.';
  }

  // Anything else is ours to diagnose, not theirs to read.
  console.error('[notion]', code ?? status ?? 'error', raw);
  if (code === 'validation_error') {
    return 'Notion turned that request down. Reconnect your workspace and try again.';
  }
  return 'Something went wrong talking to Notion. Try again in a moment.';
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
  run: Caller,
  client: Client,
  parentPageId: string,
  name: string,
  emoji: string,
  properties: Record<string, any>,
): Promise<string> {
  const res: any = await run(`create "${name}"`, () =>
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

async function propertyIds(
  run: Caller,
  client: Client,
  ds: string,
): Promise<Record<string, string>> {
  const res: any = await run('read schema', () =>
    client.dataSources.retrieve({ data_source_id: ds } as any),
  );
  const out: Record<string, string> = {};
  for (const [name, cfg] of Object.entries<any>(res.properties ?? {})) out[name] = cfg.id;
  return out;
}

/**
 * Anything already created on a previous attempt, so a retry can skip it.
 * Every field is optional because a run can fail at any point.
 */
export type ExistingDatabases = {
  parentPageId?: string | null;
  areasDs?: string | null;
  topicsDs?: string | null;
  tasksDs?: string | null;
  dailyDs?: string | null;
  headingIsSelect?: boolean;
  areaPageId?: string | null;
  topicPageIds?: Record<string, string> | null;
};

/** The ids saved as databases appear; only the one just created is set. */
export type DatabaseShells = {
  parentPageId: string;
  areasDs?: string;
  topicsDs?: string;
  tasksDs?: string;
  dailyDs?: string;
  headingIsSelect?: boolean;
};

export async function createDatabases(
  token: string,
  parentPageRaw: string,
  /** Reuse whatever a previous attempt managed to create. */
  existing: ExistingDatabases = {},
  /** Called as each database is created, so none is orphaned by a failure. */
  onCreated?: (d: DatabaseShells) => Promise<void>,
): Promise<CreatedDatabases> {
  const client = new Client({ auth: token });
  const run = callerFor(token);
  const parentPageId = existing.parentPageId || normalizeNotionId(parentPageRaw);

  // Fail early with a clear message if the integration cannot see the page,
  // rather than half-creating databases.
  await run('open parent page', () => client.pages.retrieve({ page_id: parentPageId }));

  // Each id is saved the moment its database exists. Saving all four at the
  // end was not enough: when "Tasks" failed, the Areas and Topics databases
  // already made were never recorded, and every retry added another pair to
  // the user's page.
  const keep = (d: Omit<DatabaseShells, 'parentPageId'>) =>
    onCreated?.({ parentPageId, ...d }) ?? Promise.resolve();

  let areasDs = existing.areasDs;
  if (!areasDs) {
    areasDs = await createDb(run, client, parentPageId, 'Areas', '🎯', areasProperties());
    await keep({ areasDs });
  }
  let topicsDs = existing.topicsDs;
  if (!topicsDs) {
    topicsDs = await createDb(run, client, parentPageId, 'Topics', '📚', topicsProperties(areasDs));
    await keep({ topicsDs });
  }

  // Heading is a select so Notion can group by it. Notion rejects commas in
  // option names, and one heading has them, so fall back to rich_text rather
  // than ever altering a heading from the source sheet.
  const headings = uniqueHeadings();
  let tasksDs: string;
  let headingSelect = existing.headingIsSelect ?? true;

  if (existing.tasksDs) {
    tasksDs = existing.tasksDs;
  } else {
    try {
      tasksDs = await createDb(
        run,
        client,
        parentPageId,
        'Tasks',
        '✅',
        tasksProperties(areasDs, topicsDs, headings, true),
      );
    } catch (e) {
      // Only the comma-in-select case justifies a second attempt. Retrying
      // after an auth failure or a timeout would create a duplicate Tasks
      // database and bury the error that actually mattered.
      if (!isSelectOptionRejection(e)) throw e;
      headingSelect = false;
      tasksDs = await createDb(
        run,
        client,
        parentPageId,
        'Tasks',
        '✅',
        tasksProperties(areasDs, topicsDs, headings, false),
      );
    }
    await keep({ tasksDs, headingIsSelect: headingSelect });
  }

  let dailyDs = existing.dailyDs;
  if (!dailyDs) {
    dailyDs = await createDb(run, client, parentPageId, 'Daily Notes', '📝', dailyProperties());
    await keep({ dailyDs });
  }

  // Rollups can only be added once the dual relations exist on Areas/Topics.
  await run('add Areas rollups', () =>
    client.dataSources.update({ data_source_id: areasDs, properties: areaRollups() } as any),
  );
  await run('add Topics rollups', () =>
    client.dataSources.update({ data_source_id: topicsDs, properties: topicRollups() } as any),
  );

  // Area + topics are few enough to create in this same step.
  let areaPageId = existing.areaPageId ?? '';
  if (!areaPageId) {
    const areaRes: any = await run('create DSA area', () =>
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
    areaPageId = areaRes.id;
  }

  const topicPageIds: Record<string, string> = { ...(existing.topicPageIds ?? {}) };
  for (const s of SEED.sections) {
    if (topicPageIds[s.path]) continue;
    const res: any = await run(`create topic ${s.name}`, () =>
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

  await buildViews(run, client, { areasDs, topicsDs, tasksDs, dailyDs });

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
  run: Caller,
  client: Client,
  ds: { areasDs: string; topicsDs: string; tasksDs: string; dailyDs: string },
) {
  const safe = async (label: string, body: Record<string, any>) => {
    try {
      await run(`view ${label}`, () => (client as any).views.create(body));
    } catch {
      /* views are a nicety; never block provisioning on one */
    }
  };

  const taskP = await propertyIds(run, client, ds.tasksDs).catch(() => ({}) as Record<string, string>);
  const dailyP = await propertyIds(run, client, ds.dailyDs).catch(() => ({}) as Record<string, string>);

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

/**
 * Writes the next `size` questions and reports how far it actually got.
 *
 * It deliberately does NOT throw partway through. An earlier version did, and
 * the caller then saved the cursor it started with — so every row the chunk had
 * already written was created a second time on retry. Returning the real cursor
 * alongside the error is what makes the resume guarantee true.
 */
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
): Promise<{ cursor: number; total: number; done: boolean; error?: string }> {
  const client = new Client({ auth: token });
  const run = callerFor(token);
  const all = flatQuestions();
  const start = Math.max(0, Math.min(cursor, all.length));
  const end = Math.min(start + size, all.length);

  // Advances only after a write lands, so it always reflects reality.
  let written = start;

  for (let i = start; i < end; i++) {
    const q = all[i];
    const topicId = d.topicPageIds[q.sectionPath];
    if (!topicId) {
      return {
        cursor: written,
        total: all.length,
        done: false,
        error: `No Notion topic for section "${q.sectionPath}". Reconnect Notion to rebuild it.`,
      };
    }

    try {
      await run(`create "${q.name.slice(0, 40)}"`, () =>
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
    } catch (e) {
      // Stop here and hand back the cursor as it truly stands, so the next
      // attempt starts on the row that failed rather than repeating the batch.
      return {
        cursor: written,
        total: all.length,
        done: false,
        error: friendlyNotionError(e),
      };
    }
    written = i + 1;
  }

  return { cursor: written, total: all.length, done: written >= all.length };
}


