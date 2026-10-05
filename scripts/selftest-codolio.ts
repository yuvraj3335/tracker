/** Fake-Notion migration checks: no personal workspace is read or written. */
import type { Client } from '@notionhq/client';
import seed from '../data/a2z-seed.json';
import crosswalk from '../data/a2z-crosswalk.json';
import { P, tasksProperties } from '../src/lib/schema';
import { flatQuestions } from '../src/lib/provision';
import { migrateSheetChunk } from '../src/lib/sheet-migration';
import type { Connection } from '../src/lib/db';

/* eslint-disable @typescript-eslint/no-explicit-any */
const rt = (s: string) => [{ type: 'text', text: { content: s }, plain_text: s }];
const oldRow = (id: string, source: string, opts: { done?: boolean; date?: string; difficulty?: string; bookmark?: boolean; notes?: string } = {}): any => ({
  id,
  properties: {
    [P.task.sourceId]: { rich_text: rt(source) },
    [P.task.name]: { title: rt(id) },
    [P.task.done]: { checkbox: opts.done ?? false },
    [P.task.completedOn]: { date: opts.date ? { start: opts.date } : null },
    [P.task.difficulty]: { select: opts.difficulty ? { name: opts.difficulty } : null },
    [P.task.bookmarked]: { checkbox: opts.bookmark ?? false },
    [P.task.revisit]: { checkbox: false },
    [P.task.notes]: { rich_text: opts.notes ? rt(opts.notes) : [] },
    [P.task.area]: { relation: [{ id: 'area' }] },
    [P.task.topic]: { relation: [{ id: 'topic-0' }] },
  },
});

function fake(rows: any[]) {
  const template = tasksProperties('area', 'topic-0', [], false);
  const properties: Record<string, any> = {};
  // Existing v1 schema: omit every Codolio-specific column.
  for (const [name, value] of Object.entries(template)) {
    if ([P.task.codolioLesson, P.task.sourceDifficulty, P.task.sheetStatus,
      P.task.previousSourceId, P.task.legacySection, P.task.problem, P.task.resource].includes(name as any)) continue;
    properties[name] = { type: Object.keys(value)[0], ...value };
  }
  let creates = 0;
  const views: { id: string; name: string }[] = [];
  const client = {
    dataSources: {
      retrieve: async () => ({ properties }),
      update: async ({ properties: added }: any) => {
        for (const [name, value] of Object.entries(added)) {
          properties[name] = { type: Object.keys(value as object)[0], ...value as object };
        }
        return { properties };
      },
      query: async ({ start_cursor, page_size }: any) => {
        const from = start_cursor ? Number(start_cursor) : 0;
        const next = from + page_size;
        return { results: rows.slice(from, next), has_more: next < rows.length, next_cursor: next < rows.length ? String(next) : null };
      },
    },
    pages: {
      update: async ({ page_id, properties: patch }: any) => {
        const row = rows.find((r) => r.id === page_id);
        if (!row) throw new Error('fake page missing');
        Object.assign(row.properties, patch);
        return row;
      },
      create: async ({ properties: patch }: any) => {
        creates++;
        const row = { id: `new-${creates}`, properties: patch };
        rows.push(row);
        return row;
      },
    },
    views: {
      list: async () => ({ results: views.map((v) => ({ id: v.id })) }),
      retrieve: async ({ view_id }: any) => views.find((v) => v.id === view_id),
      create: async ({ name }: any) => {
        const view = { id: `view-${views.length}`, name };
        views.push(view);
        return view;
      },
      update: async () => ({}),
    },
  };
  return { client: client as unknown as Client, rows, views, get creates() { return creates; } };
}

const connection = {
  userId: '00000000-0000-0000-0000-000000000001',
  tasksDs: 'tasks', topicsDs: 'topics', areaPageId: 'area',
  topicPageIds: Object.fromEntries(seed.sections.map((s, i) => [s.path, `topic-${i}`])),
} as Connection;

export async function codolioMigrationTests(check: (name: string, yes: boolean, detail?: string) => void) {
  const q = flatQuestions()[47];
  const mapping = crosswalk.byCodolioId[q.sourceId as keyof typeof crosswalk.byCodolioId];
  const primary = oldRow('primary', mapping.primaryLegacyKey!, { difficulty: 'Hard', notes: 'My original solution' });
  const duplicate = oldRow('duplicate', mapping.duplicateLegacyKeys[0], {
    done: true, date: '2026-09-20', difficulty: 'Easy', bookmark: true,
  });
  const f = fake([primary, duplicate]);
  const first = await migrateSheetChunk(connection, 'fake-codolio-test', 47, 1, f.client);
  check('a matched Notion page migrates in place', first.cursor === 48 && f.creates === 0,
    first.error ?? '');
  check('the original page id survives', f.rows.some((r) => r.id === 'primary' &&
    r.properties[P.task.sourceId]?.rich_text?.[0]?.text?.content === `codolio:${q.sourceId}`));
  check('duplicate completion/date and bookmark merge',
    primary.properties[P.task.done]?.checkbox === true &&
    primary.properties[P.task.completedOn]?.date?.start === '2026-09-20' &&
    primary.properties[P.task.bookmarked]?.checkbox === true);
  check('manual difficulty is not overwritten by source or duplicate',
    primary.properties[P.task.difficulty]?.select?.name === 'Hard' &&
    primary.properties[P.task.sourceDifficulty]?.select?.name === q.difficulty);
  check('personal notes survive the title and link rewrite',
    primary.properties[P.task.notes]?.rich_text?.[0]?.plain_text === 'My original solution' &&
    primary.properties[P.task.problem]?.url === q.problemLink);
  check('the duplicate page is still in Notion before archival', f.rows.length === 2);
  const replay = await migrateSheetChunk(connection, 'fake-codolio-test', 47, 1, f.client);
  check('replaying a lost response does not create or reset progress', replay.cursor === 48 &&
    f.creates === 0 && primary.properties[P.task.done]?.checkbox === true);
  const archive = await migrateSheetChunk(connection, 'fake-codolio-test', 455, 1, f.client);
  check('duplicate is archived without deletion', archive.cursor === 456 && f.rows.length === 2 &&
    duplicate.properties[P.task.sheetStatus]?.select?.name === 'Legacy' &&
    duplicate.properties[P.task.area]?.relation?.length === 0);

  const newId = crosswalk.newQuestions[0];
  const newIndex = flatQuestions().findIndex((x) => x.sourceId === newId);
  const empty = fake([]);
  const created = await migrateSheetChunk(connection, 'fake-codolio-new', newIndex, 1, empty.client);
  check('a genuinely new Codolio question is created once', created.cursor === newIndex + 1 && empty.creates === 1);
  await migrateSheetChunk(connection, 'fake-codolio-new', newIndex, 1, empty.client);
  check('a lost create response is found by Codolio Source Id', empty.creates === 1);

  const completeRows = flatQuestions().map((x, i) => ({
    id: `active-${i}`,
    properties: {
      [P.task.sourceId]: { rich_text: rt(`codolio:${x.sourceId}`) },
      [P.task.name]: { title: rt(x.name) },
      [P.task.sheetStatus]: { select: { name: 'Codolio' } },
      [P.task.codolioLesson]: { rich_text: rt(x.headingName) },
      [P.task.sourceDifficulty]: { select: { name: x.difficulty } },
      [P.task.order]: { number: x.globalOrder },
      [P.task.headingOrder]: { number: x.headingOrder },
      [P.task.taskOrder]: { number: x.order },
      [P.task.problem]: { url: x.problemLink || null },
      [P.task.resource]: { url: x.resourceLink || null },
      [P.task.area]: { relation: [{ id: 'area' }] },
      [P.task.topic]: { relation: [{ id: connection.topicPageIds?.[x.sectionPath] }] },
    },
  }));
  const complete = fake(completeRows);
  const verified = await migrateSheetChunk(connection, 'fake-codolio-verify', 474, 1, complete.client);
  check('455 distinct active rows pass the final read-back', verified.done && verified.cursor === 475,
    verified.error ?? '');
  await migrateSheetChunk(connection, 'fake-codolio-verify', 474, 1, complete.client);
  check('replaying finalization does not duplicate Notion views', complete.views.length === 2);
  completeRows.pop();
  const notComplete = await migrateSheetChunk(connection, 'fake-codolio-verify', 474, 1, complete.client);
  check('one missing row blocks the version flip and rewinds safely', !notComplete.done && notComplete.cursor === 0 &&
    Boolean(notComplete.error?.includes('454 active questions')));
}
