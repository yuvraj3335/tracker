/**
 * Creates the Notion workspace and seeds Striver's A2Z sheet into it.
 *
 *   npx tsx scripts/seed-notion.ts --parent <notion-page-url-or-id>
 *
 * What it builds:
 *   Areas  (Job Switch prep areas — DSA is the first of many)
 *   Topics (the sheet's 18 sections)
 *   Tasks  (the sheet's 456 questions)
 *   Daily  (optional journal; the Daily Tracker itself is derived)
 *   + rollups on Areas/Topics, and a set of ready-made Notion views
 *
 * Safe to re-run. Existing rows are matched on `Source Id` and skipped, so an
 * interrupted seed resumes instead of duplicating. Database ids are written to
 * .env.local; re-running with those set reuses the databases.
 *
 * Nothing in the source data is altered. Difficulty is seeded blank because the
 * source sheet does not carry it.
 */
import { Client, APIResponseError } from '@notionhq/client';
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import {
  P,
  areasProperties,
  topicsProperties,
  tasksProperties,
  areaRollups,
  topicRollups,
  dailyProperties,
} from '../src/lib/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Seed = {
  source: string;
  sourceBundle: string;
  scrapedAt: string;
  siteDeclaredTotal: number;
  totals: { sections: number; headings: number; questions: number; questionsWithNoUrl: number };
  sections: Array<{
    order: number;
    name: string;
    path: string;
    headings: Array<{
      order: number;
      name: string;
      questions: Array<{
        order: number;
        name: string;
        tufLink: string;
        leetCodeLink: string;
        gfgLink: string;
        youTubeLink: string;
        sourceId: string;
        globalOrder: number;
      }>;
    }>;
  }>;
};

const ROOT = path.resolve(import.meta.dirname, '..');
const SEED_FILE = path.join(ROOT, 'data/a2z-seed.json');
const ENV_FILE = path.join(ROOT, '.env.local');

const args = process.argv.slice(2);
const arg = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};

const TOKEN = process.env.NOTION_TOKEN;
const PARENT_RAW = arg('--parent') ?? process.env.NOTION_PARENT_PAGE;

const log = (...a: unknown[]) => console.log('[seed]', ...a);
const warn = (...a: unknown[]) => console.warn('[seed] !', ...a);

/** Accepts a full Notion URL or a bare id and returns a dashed uuid. */
function normalizeId(raw: string): string {
  const hex = raw.trim().replace(/-/g, '').match(/[0-9a-fA-F]{32}(?![0-9a-fA-F])/g);
  if (!hex?.length) throw new Error(`could not find a Notion id in: ${raw}`);
  const h = hex[hex.length - 1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// --- throttling: Notion allows roughly 3 requests/second -------------------
const GAP_MS = 340;
let lastAt = 0;
async function throttle() {
  const wait = GAP_MS - (Date.now() - lastAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
}

/** Retries rate limits and transient 5xx with backoff. */
async function call<T>(label: string, fn: () => Promise<T>, attempt = 1): Promise<T> {
  await throttle();
  try {
    return await fn();
  } catch (e) {
    const err = e as APIResponseError;
    const status = (err as any)?.status;
    const retryable = status === 429 || status === 502 || status === 503 || status === 504;
    if (retryable && attempt <= 6) {
      const backoff = status === 429 ? 1500 * attempt : 800 * attempt;
      warn(`${label} -> ${status}, retry ${attempt} in ${backoff}ms`);
      await new Promise((r) => setTimeout(r, backoff));
      return call(label, fn, attempt + 1);
    }
    throw new Error(`${label} failed: ${(err as any)?.body ?? err.message}`);
  }
}

const notion = new Client({ auth: TOKEN });

const rtv = (s: string) => [{ type: 'text' as const, text: { content: s } }];

/** Creates a database and returns { databaseId, dataSourceId }. */
async function createDb(
  parentPageId: string,
  name: string,
  emoji: string,
  properties: Record<string, any>,
) {
  const res: any = await call(`create db "${name}"`, () =>
    notion.databases.create({
      parent: { type: 'page_id', page_id: parentPageId },
      title: rtv(name),
      icon: { type: 'emoji', emoji } as any,
      initial_data_source: { properties },
    } as any),
  );
  const dataSourceId = res.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error(`no data source returned for "${name}"`);
  log(`created "${name}"  db=${res.id}  ds=${dataSourceId}`);
  return { databaseId: res.id as string, dataSourceId: dataSourceId as string };
}

async function addProperties(dataSourceId: string, properties: Record<string, any>, label: string) {
  await call(`add properties to ${label}`, () =>
    notion.dataSources.update({ data_source_id: dataSourceId, properties } as any),
  );
  log(`added ${Object.keys(properties).length} properties to ${label}`);
}

/** name -> property id, needed by calendar/board view configs. */
async function propertyIds(dataSourceId: string): Promise<Record<string, string>> {
  const ds: any = await call('retrieve data source', () =>
    notion.dataSources.retrieve({ data_source_id: dataSourceId } as any),
  );
  const out: Record<string, string> = {};
  for (const [name, cfg] of Object.entries<any>(ds.properties ?? {})) out[name] = cfg.id;
  return out;
}

async function createView(body: Record<string, any>, label: string) {
  try {
    await call(`create view "${label}"`, () => (notion as any).views.create(body));
    log(`view "${label}" created`);
  } catch (e) {
    // A view failing is cosmetic — never abort the seed over one.
    warn(`view "${label}" could not be created: ${(e as Error).message}`);
  }
}

function upsertEnv(vars: Record<string, string>) {
  let existing = '';
  try { existing = fs.readFileSync(ENV_FILE, 'utf8'); } catch { /* first run */ }
  const lines = existing.split('\n').filter(Boolean);
  const keep = lines.filter((l) => !Object.keys(vars).some((k) => l.startsWith(k + '=')));
  const next = [...keep, ...Object.entries(vars).map(([k, v]) => `${k}=${v}`)].join('\n') + '\n';
  fs.writeFileSync(ENV_FILE, next);
  log(`wrote ${Object.keys(vars).length} vars to .env.local`);
}

async function queryAll(dataSourceId: string, body: Record<string, unknown> = {}) {
  const out: any[] = [];
  let cursor: string | undefined;
  do {
    const res: any = await call('query', () =>
      notion.dataSources.query({
        data_source_id: dataSourceId,
        page_size: 100,
        start_cursor: cursor,
        ...body,
      } as any),
    );
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

async function main() {
  if (!TOKEN) {
    console.error(
      '\nNOTION_TOKEN is not set.\n' +
        '  1. Create an internal integration: https://www.notion.so/my-integrations\n' +
        '  2. Put its secret in .env.local as NOTION_TOKEN=ntn_...\n',
    );
    process.exit(1);
  }
  if (!PARENT_RAW) {
    console.error(
      '\nNo parent page given.\n' +
        '  Create a blank Notion page, open its ... menu -> Connections -> add your\n' +
        '  integration, then re-run with:\n' +
        '    npx tsx scripts/seed-notion.ts --parent <page-url>\n',
    );
    process.exit(1);
  }

  const parent = normalizeId(PARENT_RAW);
  const seed: Seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));

  log(`source     ${seed.source}`);
  log(`scraped    ${seed.scrapedAt}`);
  log(`sections   ${seed.totals.sections}`);
  log(`headings   ${seed.totals.headings}`);
  log(`questions  ${seed.totals.questions}`);
  log(`parent     ${parent}`);

  const headings = [...new Set(seed.sections.flatMap((s) => s.headings.map((h) => h.name)))];

  // ---- databases (reuse when .env.local already has them) ----------------
  let areasDs = process.env.NOTION_AREAS_DS;
  let topicsDs = process.env.NOTION_TOPICS_DS;
  let tasksDs = process.env.NOTION_TASKS_DS;
  let dailyDs = process.env.NOTION_DAILY_DS;
  const reusing = Boolean(areasDs && topicsDs && tasksDs);

  if (reusing) {
    log('reusing existing databases from .env.local (resume mode)');
  } else {
    const areas = await createDb(parent, 'Areas', '🎯', areasProperties());
    areasDs = areas.dataSourceId;

    const topics = await createDb(parent, 'Topics', '📚', topicsProperties(areasDs));
    topicsDs = topics.dataSourceId;

    // Heading is a select so Notion can group by it. If Notion rejects the one
    // heading containing a comma, fall back to rich_text — the name is never
    // altered to make it fit.
    let tasks;
    try {
      tasks = await createDb(parent, 'Tasks', '✅', tasksProperties(areasDs, topicsDs, headings, true));
    } catch (e) {
      warn('Tasks with Heading as select failed; retrying with rich_text.');
      warn(`  reason: ${(e as Error).message.slice(0, 300)}`);
      tasks = await createDb(parent, 'Tasks', '✅', tasksProperties(areasDs, topicsDs, headings, false));
      warn('Heading is rich_text — exact names preserved; group-by needs a manual view tweak.');
    }
    tasksDs = tasks.dataSourceId;

    const daily = await createDb(parent, 'Daily Notes', '📝', dailyProperties());
    dailyDs = daily.dataSourceId;

    // Rollups can only be added once the dual relations exist on Areas/Topics.
    await addProperties(areasDs, areaRollups(), 'Areas');
    await addProperties(topicsDs, topicRollups(), 'Topics');

    await buildViews({ areasDs, topicsDs, tasksDs, dailyDs });
  }

  upsertEnv({
    NOTION_AREAS_DS: areasDs!,
    NOTION_TOPICS_DS: topicsDs!,
    NOTION_TASKS_DS: tasksDs!,
    NOTION_DAILY_DS: dailyDs ?? '',
  });

  // ---- Area row ----------------------------------------------------------
  const existingAreas = await queryAll(areasDs!);
  let areaId = existingAreas.find(
    (r) => (r.properties[P.area.slug]?.rich_text ?? []).map((t: any) => t.plain_text).join('') === 'dsa',
  )?.id;

  if (!areaId) {
    const res: any = await call('create area DSA', () =>
      notion.pages.create({
        parent: { type: 'data_source_id', data_source_id: areasDs! },
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
    areaId = res.id;
    log('created Area "DSA"');
  } else {
    log('Area "DSA" already exists — reusing');
  }

  // ---- Topic rows (the 18 sections) --------------------------------------
  const existingTopics = await queryAll(topicsDs!);
  const topicByPath = new Map<string, string>();
  for (const r of existingTopics) {
    const p = (r.properties[P.topic.path]?.rich_text ?? []).map((t: any) => t.plain_text).join('');
    if (p) topicByPath.set(p, r.id);
  }

  for (const s of seed.sections) {
    if (topicByPath.has(s.path)) continue;
    const res: any = await call(`create topic ${s.name}`, () =>
      notion.pages.create({
        parent: { type: 'data_source_id', data_source_id: topicsDs! },
        properties: {
          [P.topic.name]: { title: rtv(s.name) },
          [P.topic.order]: { number: s.order },
          [P.topic.path]: { rich_text: rtv(s.path) },
          [P.topic.area]: { relation: [{ id: areaId! }] },
        } as any,
      } as any),
    );
    topicByPath.set(s.path, res.id);
    log(`topic ${s.order + 1}/${seed.sections.length}  ${s.name}`);
  }

  // ---- Task rows (the 456 questions) ------------------------------------
  // Matched on a composite key so a re-run resumes rather than duplicates.
  const existingTasks = await queryAll(tasksDs!);
  const seen = new Set(
    existingTasks.map((r) =>
      (r.properties[P.task.sourceId]?.rich_text ?? []).map((t: any) => t.plain_text).join(''),
    ),
  );
  log(`existing tasks in Notion: ${existingTasks.length}`);

  // Heading is select or rich_text depending on whether the comma fallback
  // kicked in, so read the live schema rather than assuming.
  const dsLive: any = await call('retrieve tasks ds', () =>
    notion.dataSources.retrieve({ data_source_id: tasksDs! } as any),
  );
  const headingType: string = dsLive.properties?.[P.task.heading]?.type ?? 'select';
  log(`Heading property type: ${headingType}`);

  const url = (v: string) => ({ url: v && v.trim() ? v.trim() : null });

  let created = 0;
  let skipped = 0;
  const total = seed.totals.questions;

  for (const s of seed.sections) {
    const topicId = topicByPath.get(s.path)!;
    for (const h of s.headings) {
      for (const q of h.questions) {
        // Composite key: the source's own id is not unique across sections.
        const key = `${s.path}|${h.order}|${q.order}|${q.sourceId}`;
        if (seen.has(key)) { skipped++; continue; }

        await call(`create task ${q.name.slice(0, 40)}`, () =>
          notion.pages.create({
            parent: { type: 'data_source_id', data_source_id: tasksDs! },
            properties: {
              [P.task.name]: { title: rtv(q.name) },
              [P.task.done]: { checkbox: false },
              [P.task.area]: { relation: [{ id: areaId! }] },
              [P.task.topic]: { relation: [{ id: topicId }] },
              [P.task.heading]:
                headingType === 'select'
                  ? { select: { name: h.name } }
                  : { rich_text: rtv(h.name) },
              // Difficulty deliberately omitted — the source has none.
              [P.task.order]: { number: q.globalOrder },
              [P.task.headingOrder]: { number: h.order },
              [P.task.taskOrder]: { number: q.order },
              [P.task.tuf]: url(q.tufLink),
              [P.task.leetcode]: url(q.leetCodeLink),
              [P.task.gfg]: url(q.gfgLink),
              [P.task.youtube]: url(q.youTubeLink),
              [P.task.bookmarked]: { checkbox: false },
              [P.task.revisit]: { checkbox: false },
              [P.task.sourceId]: { rich_text: rtv(key) },
            } as any,
          } as any),
        );
        created++;
        if (created % 25 === 0) {
          const pctDone = Math.round(((created + skipped) / total) * 100);
          log(`${created + skipped}/${total} (${pctDone}%)  …${s.name}`);
        }
      }
    }
  }

  // ---- verify ------------------------------------------------------------
  const finalTasks = await queryAll(tasksDs!);
  log('');
  log('=================== done ===================');
  log(`created ${created}, skipped ${skipped}`);
  log(`tasks now in Notion: ${finalTasks.length}  (expected ${total})`);
  if (finalTasks.length !== total) {
    warn(`COUNT MISMATCH — expected ${total}, found ${finalTasks.length}. Re-run to fill gaps.`);
  }
  log('');
  log('Add these to Vercel (and they are already in .env.local):');
  log(`  NOTION_TOKEN=<your token>`);
  log(`  NOTION_AREAS_DS=${areasDs}`);
  log(`  NOTION_TOPICS_DS=${topicsDs}`);
  log(`  NOTION_TASKS_DS=${tasksDs}`);
  log(`  NOTION_DAILY_DS=${dailyDs}`);
  log(`  APP_PASSWORD=<pick one>`);
  log(`  APP_TIMEZONE=Asia/Kolkata`);
}

/** Ready-made Notion views, so the workspace is usable the moment it exists. */
async function buildViews(ds: {
  areasDs: string;
  topicsDs: string;
  tasksDs: string;
  dailyDs: string;
}) {
  const taskP = await propertyIds(ds.tasksDs);
  const dailyP = await propertyIds(ds.dailyDs);
  const topicP = await propertyIds(ds.topicsDs);

  // The Daily Tracker: a calendar keyed on Completed On. Ticking a question
  // places it on that day automatically — this IS the look-back view.
  if (taskP[P.task.completedOn]) {
    await createView(
      {
        data_source_id: ds.tasksDs,
        name: 'Daily Tracker',
        type: 'calendar',
        configuration: {
          type: 'calendar',
          date_property_id: taskP[P.task.completedOn],
          view_range: 'month',
          show_weekends: true,
        },
      },
      'Daily Tracker (calendar)',
    );
  }

  await createView(
    {
      data_source_id: ds.tasksDs,
      name: 'Done Log',
      type: 'table',
      filter: { property: P.task.done, checkbox: { equals: true } },
      sorts: [{ property: P.task.completedOn, direction: 'descending' }],
    },
    'Done Log',
  );

  if (taskP[P.task.topic]) {
    await createView(
      {
        data_source_id: ds.tasksDs,
        name: 'By Topic',
        type: 'table',
        configuration: {
          type: 'table',
          group_by: { type: 'relation', property_id: taskP[P.task.topic], sort: { type: 'manual' } },
        },
        sorts: [{ property: P.task.order, direction: 'ascending' }],
      },
      'By Topic',
    );
  }

  await createView(
    {
      data_source_id: ds.tasksDs,
      name: 'Bookmarked',
      type: 'table',
      filter: { property: P.task.bookmarked, checkbox: { equals: true } },
    },
    'Bookmarked',
  );

  await createView(
    {
      data_source_id: ds.tasksDs,
      name: 'Revisit',
      type: 'table',
      filter: { property: P.task.revisit, checkbox: { equals: true } },
    },
    'Revisit',
  );

  if (topicP[P.topic.order]) {
    await createView(
      {
        data_source_id: ds.topicsDs,
        name: 'Progress',
        type: 'table',
        sorts: [{ property: P.topic.order, direction: 'ascending' }],
      },
      'Topic Progress',
    );
  }

  if (dailyP[P.daily.date]) {
    await createView(
      {
        data_source_id: ds.dailyDs,
        name: 'Journal',
        type: 'calendar',
        configuration: {
          type: 'calendar',
          date_property_id: dailyP[P.daily.date],
          view_range: 'month',
          show_weekends: true,
        },
      },
      'Journal (calendar)',
    );
  }
}

main().catch((e) => {
  console.error('\n[seed] FAILED:', e.message);
  console.error('[seed] Re-running is safe — completed rows are skipped.');
  process.exit(1);
});
