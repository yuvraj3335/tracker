/** Resumable, per-user migration from the original 456-row A2Z seed to
 * Codolio's 455-row sheet. Nothing is deleted: unmatched and duplicate pages
 * are retained in Notion as Legacy, detached from DSA rollups. */
import { Client } from '@notionhq/client';
import seed from '../../data/a2z-seed.json';
import legacySeed from '../../data/a2z-legacy-seed.json';
import crosswalk from '../../data/a2z-crosswalk.json';
import { P, DIFFICULTY, tasksProperties, type Difficulty } from './schema';
import { callerFor, friendlyNotionError } from './provision';
import { invalidateTenant } from './notion';
import type { Connection } from './db';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TOTAL = 455;
const TOPICS_START = TOTAL + 1;
export const MIGRATION_TOTAL = TOPICS_START + 18 + 1;
export const MIGRATION_CHUNK = 7;
const rtv = (s: string) => [{ type: 'text' as const, text: { content: s } }];
const plain = (p: any): string => (p?.rich_text ?? []).map((x: any) => x.plain_text ?? x.text?.content ?? '').join('');
const pageTitle = (p: any): string => (p?.title ?? []).map((x: any) => x.plain_text ?? x.text?.content ?? '').join('');
const source = (r: any): string => plain(r.properties?.[P.task.sourceId]);
const url = (s: string) => ({ url: s || null });
const relation = (r: any, name: string): string[] => (r.properties?.[name]?.relation ?? []).map((x: any) => x.id);
const field = (r: any, name: string) => r.properties?.[name];
const codolioId = (id: string) => `codolio:${id}`;
class MigrationProblem extends Error {
  constructor(message: string, readonly restartAt?: number) { super(message); }
}

type Question = (typeof seed.sections)[number]['headings'][number]['questions'][number] & {
  sectionPath: string; headingName: string; headingOrder: number;
};

const questions: Question[] = seed.sections.flatMap((section) => section.headings.flatMap((heading) =>
  heading.questions.map((question) => ({
    ...question,
    sectionPath: section.path,
    headingName: heading.name,
    headingOrder: heading.order,
  })),
)).sort((a, b) => a.globalOrder - b.globalOrder);

if (questions.length !== TOTAL) throw new Error('Codolio seed is not 455 questions');

export type ProgressSnapshot = {
  done: boolean;
  completedOn: string | null;
  difficulty: Difficulty | null;
  bookmarked: boolean;
  revisit: boolean;
};

function snapshot(r: any): ProgressSnapshot {
  const diff = field(r, P.task.difficulty)?.select?.name;
  return {
    done: field(r, P.task.done)?.checkbox === true,
    completedOn: field(r, P.task.completedOn)?.date?.start ?? null,
    difficulty: DIFFICULTY.includes(diff) ? diff as Difficulty : null,
    bookmarked: field(r, P.task.bookmarked)?.checkbox === true,
    revisit: field(r, P.task.revisit)?.checkbox === true,
  };
}

/** Primary manual difficulty wins; duplicates can only add progress, never
 * undo it. Their own pages remain available for conflicting notes/values. */
export function mergeProgress(primary: ProgressSnapshot | null, duplicates: ProgressSnapshot[], sourceDifficulty: Difficulty): ProgressSnapshot {
  const all = [primary, ...duplicates].filter((x): x is ProgressSnapshot => Boolean(x));
  const doneWithDate = all.find((x) => x.done && x.completedOn);
  return {
    done: all.some((x) => x.done),
    completedOn: doneWithDate?.completedOn ?? null,
    difficulty: primary?.difficulty ?? duplicates.find((x) => x.difficulty)?.difficulty ?? sourceDifficulty,
    bookmarked: all.some((x) => x.bookmarked),
    revisit: all.some((x) => x.revisit),
  };
}

function wantedColumns() {
  const all = tasksProperties('unused', 'unused', [], false);
  const names = [
    P.task.codolioLesson, P.task.sourceDifficulty, P.task.sheetStatus,
    P.task.previousSourceId, P.task.legacySection, P.task.problem, P.task.resource,
  ];
  return Object.fromEntries(names.map((name) => [name, all[name as keyof typeof all]]));
}

async function ensureColumns(client: Client, token: string, ds: string) {
  const run = callerFor(token);
  const res: any = await run('read task schema', () => client.dataSources.retrieve({ data_source_id: ds } as any));
  const existing = res?.properties;
  if (!existing) throw new MigrationProblem('Notion did not return the Tasks schema; no migration writes were made.');
  const wanted = wantedColumns();
  const missing: Record<string, any> = {};
  for (const [name, config] of Object.entries(wanted)) {
    const current = existing[name];
    const type = Object.keys(config as object)[0];
    if (current && current.type !== type) {
      throw new MigrationProblem(`The Notion Tasks column “${name}” is already a ${current.type}. Rename it, then retry the migration.`);
    }
    if (!current) missing[name] = config;
  }
  const difficulty = existing[P.task.difficulty];
  if (difficulty?.type !== 'select') throw new MigrationProblem('The Notion Tasks Difficulty column is not a select. Restore or rename it, then retry.');
  const options = difficulty.select?.options ?? [];
  if (!options.some((o: any) => o.name === 'Basic')) {
    missing[P.task.difficulty] = { select: { options: [
      ...options.map((o: any) => ({ name: o.name, color: o.color })),
      { name: 'Basic', color: 'gray' },
    ] } };
  }
  if (Object.keys(missing).length) {
    await run('add Codolio task columns', () => client.dataSources.update({ data_source_id: ds, properties: missing } as any));
  }
}

/** Reads use the same per-integration throttle and 429 retry as writes. */
async function readRows(client: Client, token: string, ds: string): Promise<any[]> {
  const run = callerFor(token);
  const rows: any[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const res: any = await run('read tracker questions', () => client.dataSources.query({
      data_source_id: ds, page_size: 100, start_cursor: cursor,
    } as any));
    rows.push(...(res.results ?? []));
    if (!res.has_more) return rows;
    cursor = res.next_cursor ?? undefined;
    if (!cursor) break;
  }
  throw new MigrationProblem('Notion did not finish listing tracker questions. Retry the migration.');
}

function activeProperties(q: Question, connection: Connection, progress: ProgressSnapshot, previousSourceId: string | null, original: any | null) {
  const topic = connection.topicPageIds?.[q.sectionPath];
  if (!topic || !connection.areaPageId) throw new MigrationProblem(`Missing Notion topic for ${q.sectionPath}`);
  const otherAreas = original ? relation(original, P.task.area).filter((id) => id !== connection.areaPageId) : [];
  const dsaTopics = new Set(Object.values(connection.topicPageIds ?? {}));
  const otherTopics = original ? relation(original, P.task.topic).filter((id) => !dsaTopics.has(id)) : [];
  return {
    [P.task.name]: { title: rtv(q.name) },
    [P.task.done]: { checkbox: progress.done },
    [P.task.completedOn]: { date: progress.completedOn ? { start: progress.completedOn } : null },
    [P.task.area]: { relation: [connection.areaPageId, ...otherAreas].map((id) => ({ id })) },
    [P.task.topic]: { relation: [topic, ...otherTopics].map((id) => ({ id })) },
    [P.task.codolioLesson]: { rich_text: rtv(q.headingName) },
    [P.task.difficulty]: { select: { name: progress.difficulty ?? q.difficulty } },
    [P.task.sourceDifficulty]: { select: { name: q.difficulty } },
    [P.task.sheetStatus]: { select: { name: 'Codolio' } },
    [P.task.problem]: url(q.problemLink),
    [P.task.resource]: url(q.resourceLink),
    [P.task.order]: { number: q.globalOrder },
    [P.task.headingOrder]: { number: q.headingOrder },
    [P.task.taskOrder]: { number: q.order },
    [P.task.bookmarked]: { checkbox: progress.bookmarked },
    [P.task.revisit]: { checkbox: progress.revisit },
    [P.task.sourceId]: { rich_text: rtv(codolioId(q.sourceId)) },
    [P.task.previousSourceId]: { rich_text: previousSourceId ? rtv(previousSourceId) : [] },
  };
}

function matchesCanonical(row: any, q: Question, connection: Connection): boolean {
  return pageTitle(field(row, P.task.name)) === q.name &&
    plain(field(row, P.task.codolioLesson)) === q.headingName &&
    relation(row, P.task.area).includes(connection.areaPageId ?? '') &&
    relation(row, P.task.topic).includes(connection.topicPageIds?.[q.sectionPath] ?? '') &&
    field(row, P.task.order)?.number === q.globalOrder &&
    field(row, P.task.headingOrder)?.number === q.headingOrder &&
    field(row, P.task.taskOrder)?.number === q.order &&
    field(row, P.task.sourceDifficulty)?.select?.name === q.difficulty &&
    field(row, P.task.sheetStatus)?.select?.name === 'Codolio' &&
    (field(row, P.task.problem)?.url ?? '') === q.problemLink &&
    (field(row, P.task.resource)?.url ?? '') === q.resourceLink;
}

async function ensureViews(client: Client, token: string, ds: string) {
  const run = callerFor(token);
  const found: any = await run('list task views', () => client.views.list({ data_source_id: ds, page_size: 100 }));
  // Notion's list response contains only view IDs, not names.
  const views: any[] = [];
  for (const ref of found.results ?? []) {
    views.push(await run('read task view', () => client.views.retrieve({ view_id: ref.id })));
  }
  const names = new Set(views.map((v) => v.name));
  for (const [name, status] of [['Codolio A2Z', 'Codolio'], ['Legacy A2Z', 'Legacy']] as const) {
    if (names.has(name)) continue;
    await client.views.create({
      data_source_id: ds,
      name,
      type: 'table',
      filter: { property: P.task.sheetStatus, select: { equals: status } },
      sorts: status === 'Codolio' ? [{ property: P.task.order, direction: 'ascending' }] : [],
    } as any);
  }
  // The pre-upgrade views would otherwise still show completed Legacy rows.
  const active = { property: P.task.sheetStatus, select: { does_not_equal: 'Legacy' } };
  for (const [name, oldFilter] of [
    ['Done Log', { property: P.task.done, checkbox: { equals: true } }],
    ['Bookmarked', { property: P.task.bookmarked, checkbox: { equals: true } }],
    ['Revisit', { property: P.task.revisit, checkbox: { equals: true } }],
    ['Daily Tracker', null],
  ] as const) {
    const view = views.find((v) => v.name === name);
    if (!view) continue;
    await run(`filter ${name} view`, () => client.views.update({
      view_id: view.id,
      filter: oldFilter ? { and: [oldFilter, active] } : active,
    } as any));
  }
}

/** One small chunk. The caller stores the returned cursor even on error. A
 * lost response is safe: the next call re-reads Source Ids before any create. */
export async function migrateSheetChunk(
  connection: Connection,
  token: string,
  cursor: number,
  size = MIGRATION_CHUNK,
  client: Client = new Client({ auth: token, retry: false }),
): Promise<{ cursor: number; done: boolean; error?: string }> {
  if (!connection.tasksDs || !connection.topicsDs) throw new MigrationProblem('Tracker databases are not connected.');
  const run = callerFor(token);
  let written = Math.max(0, Math.min(cursor, MIGRATION_TOTAL));
  try {
    await ensureColumns(client, token, connection.tasksDs);
    const rows = await readRows(client, token, connection.tasksDs);
    const bySource = new Map<string, any>();
    const sameSource = new Map<string, any[]>();
    for (const row of rows) if (source(row)) {
      const key = source(row);
      if (bySource.has(key)) sameSource.set(key, [...(sameSource.get(key) ?? []), row]);
      else bySource.set(key, row);
    }
    for (let n = 0; n < size && written < MIGRATION_TOTAL; n++) {
      if (written < TOTAL) {
        const q = questions[written];
        const key = codolioId(q.sourceId);
        const existing = bySource.get(key);
        if (existing && !matchesCanonical(existing, q, connection)) {
          const previous = plain(field(existing, P.task.previousSourceId));
          const props = activeProperties(q, connection, snapshot(existing), previous || null, existing);
          await run('repair Codolio question', () => client.pages.update({ page_id: existing.id, properties: props } as any));
        } else if (!existing) {
          const mapping = crosswalk.byCodolioId[q.sourceId as keyof typeof crosswalk.byCodolioId];
          const primary = mapping?.primaryLegacyKey ? bySource.get(mapping.primaryLegacyKey) : null;
          const aliases = [
            ...(mapping?.primaryLegacyKey ? sameSource.get(mapping.primaryLegacyKey) ?? [] : []),
            ...(mapping?.duplicateLegacyKeys ?? []).flatMap((x: string) =>
              [bySource.get(x), ...(sameSource.get(x) ?? [])].filter(Boolean)),
          ];
          const chosen = primary ?? aliases[0] ?? null;
          const merged = mergeProgress(chosen ? snapshot(chosen) : null,
            aliases.filter((x: any) => x.id !== chosen?.id).map(snapshot), q.difficulty as Difficulty);
          const props = activeProperties(q, connection, merged, chosen ? source(chosen) : null, chosen);
          if (chosen) {
            await run('migrate Codolio question', () => client.pages.update({ page_id: chosen.id, properties: props } as any));
            bySource.delete(source(chosen));
            bySource.set(key, chosen);
            chosen.properties[P.task.sourceId] = { rich_text: rtv(key) };
          } else {
            // Do not automatically retry a non-idempotent page creation. If the
            // response is lost, the next request re-queries by Source Id.
            const created: any = await client.pages.create({
              parent: { type: 'data_source_id', data_source_id: connection.tasksDs },
              properties: { ...props, [P.task.notes]: { rich_text: [] } },
            } as any);
            bySource.set(key, created);
          }
        }
      } else if (written < TOPICS_START) {
        const legacy = rows.filter((r) =>
          (!source(r).startsWith('codolio:') || bySource.get(source(r))?.id !== r.id) &&
          (relation(r, P.task.area).includes(connection.areaPageId ?? '') ||
            relation(r, P.task.topic).some((id) => Object.values(connection.topicPageIds ?? {}).includes(id)))
        );
        // Seven aliases and one old-only row are expected, but custom DSA
        // rows are preserved too. One cursor phase handles any number of them.
        for (const item of legacy.slice(0, size)) {
          const oldTopic = relation(item, P.task.topic)[0] ?? '';
          const oldSection = legacySeed.sections.find((s) => connection.topicPageIds?.[s.path] === oldTopic)?.name ?? '';
          const keepAreas = relation(item, P.task.area).filter((id) => id !== connection.areaPageId);
          const dsaTopics = new Set(Object.values(connection.topicPageIds ?? {}));
          const keepTopics = relation(item, P.task.topic).filter((id) => !dsaTopics.has(id));
          await run('preserve legacy question', () => client.pages.update({
            page_id: item.id,
            properties: {
              [P.task.sheetStatus]: { select: keepAreas.length ? null : { name: 'Legacy' } },
              [P.task.legacySection]: { rich_text: oldSection ? rtv(oldSection) : [] },
              [P.task.area]: { relation: keepAreas.map((id) => ({ id })) },
              [P.task.topic]: { relation: keepTopics.map((id) => ({ id })) },
            },
          } as any));
          // Reflect the detached state in this call's snapshot.
          item.properties[P.task.area].relation = keepAreas.map((id) => ({ id }));
          item.properties[P.task.topic].relation = keepTopics.map((id) => ({ id }));
        }
        if (legacy.length > size) break;
      } else if (written < TOPICS_START + 18) {
        const section = seed.sections[written - TOPICS_START];
        const id = connection.topicPageIds?.[section.path];
        if (!id) throw new MigrationProblem(`Missing Notion topic for ${section.path}`);
        await run('rename Codolio step', () => client.pages.update({
          page_id: id,
          properties: {
            [P.topic.name]: { title: rtv(section.name) },
            [P.topic.order]: { number: section.order },
          },
        } as any));
      } else {
        const verified = await readRows(client, token, connection.tasksDs);
        const active = verified.filter((r) => source(r).startsWith('codolio:') &&
          field(r, P.task.sheetStatus)?.select?.name === 'Codolio');
        if (active.length !== TOTAL || new Set(active.map(source)).size !== TOTAL) {
          throw new MigrationProblem(`Codolio verification found ${active.length} active questions, expected ${TOTAL}. Retry will recheck every question without losing progress.`, 0);
        }
        const byId = new Map(active.map((r) => [source(r), r]));
        for (const q of questions) {
          const row = byId.get(codolioId(q.sourceId));
          if (!row || !matchesCanonical(row, q, connection)) {
            throw new MigrationProblem(`Codolio question ${q.globalOrder + 1} did not match the source on read-back. Retry will repair it without changing your completion or notes.`, 0);
          }
        }
        const oldInRollup = verified.filter((r) =>
          field(r, P.task.sheetStatus)?.select?.name !== 'Codolio' &&
          relation(r, P.task.area).includes(connection.areaPageId ?? ''));
        const dsaCount = verified.filter((r) => relation(r, P.task.area).includes(connection.areaPageId ?? '')).length;
        if (oldInRollup.length || dsaCount !== TOTAL) {
          throw new MigrationProblem(`DSA rollups contain ${dsaCount} rows, including ${oldInRollup.length} legacy rows. Retry will detach old rows; none were deleted.`, TOTAL);
        }
        // Views are helpful, but some Notion integrations cannot create them.
        // The 455 verified rows and Legacy status are the source of truth.
        await ensureViews(client, token, connection.tasksDs).catch((e) => {
          console.error('[codolio] could not add Notion views:', e);
        });
      }
      written++;
    }
    invalidateTenant(connection.userId);
    return { cursor: written, done: written === MIGRATION_TOTAL };
  } catch (e) {
    return { cursor: e instanceof MigrationProblem ? e.restartAt ?? written : written,
      done: false, error: e instanceof MigrationProblem ? e.message : friendlyNotionError(e) };
  }
}
