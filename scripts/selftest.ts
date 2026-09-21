/**
 * End-to-end checks for the parts that cannot be exercised through the UI
 * without a live Notion workspace: password hashing, token encryption, session
 * signing, the provisioning cursor, and timezone-sensitive day maths.
 *
 *   npx tsx scripts/selftest.ts
 */
import { config } from 'dotenv';
// Secrets live in .env.local (gitignored), not .env.
config({ path: '.env.local', quiet: true });
import { hashPassword, verifyPassword, sealToken, openToken } from '../src/lib/crypto';
import { createSessionCookie, readSessionCookie } from '../src/lib/session';
import {
  flatQuestions,
  TOTAL_QUESTIONS,
  normalizeNotionId,
  uniqueHeadings,
  seedChunk,
} from '../src/lib/provision';
import { shiftKey, formatKey, daysBetween, heatmapGrid, keyToDate } from '../src/lib/date';
import { streaks, countsByDay, overallProgress, areaProgress } from '../src/lib/derive';
import type { Area, Task } from '../src/lib/notion';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}
const section = (s: string) => console.log(`\n${s}`);

function task(p: Partial<Task>): Task {
  return {
    id: 'x', name: 'q', done: false, completedOn: null, areaIds: ['a1'], topicIds: ['t1'],
    heading: 'h', difficulty: null, order: 0, headingOrder: 0, taskOrder: 0,
    links: { tuf: '', leetcode: '', gfg: '', youtube: '' },
    bookmarked: false, revisit: false, notes: '', sourceId: '', ...p,
  };
}
const area = (p: Partial<Area>): Area => ({
  id: 'a1', name: 'DSA', slug: 'dsa', emoji: '', weight: 1, status: 'Active', order: 0, ...p,
});

async function main() {
  section('Passwords (scrypt)');
  const h = await hashPassword('correct horse battery');
  check('hash is salted scrypt', h.startsWith('scrypt$') && h.split('$').length === 3);
  check('correct password verifies', await verifyPassword('correct horse battery', h));
  check('wrong password rejected', !(await verifyPassword('wrong', h)));
  const h2 = await hashPassword('correct horse battery');
  check('same password -> different hash (unique salt)', h !== h2);
  check('garbage stored hash rejected', !(await verifyPassword('x', 'nonsense')));
  check('empty stored hash rejected', !(await verifyPassword('x', '')));

  section('Notion token encryption (AES-256-GCM)');
  const secret = 'ntn_abc123def456';
  const sealed = sealToken(secret);
  check('ciphertext differs from plaintext', sealed.ciphertext !== secret);
  check('round-trips', openToken(sealed) === secret);
  const again = sealToken(secret);
  check('same input -> different ciphertext (unique IV)', again.ciphertext !== sealed.ciphertext);
  let tampered = false;
  try {
    const bad = { ...sealed, ciphertext: Buffer.from('zzzzzzzzzzzz').toString('base64') };
    openToken(bad);
  } catch { tampered = true; }
  check('tampering is detected, not silently decrypted', tampered);

  section('Sessions (HMAC signed cookie)');
  const uid = '3fbaed62-f65f-4538-80a5-1dfe788e8789';
  const cookie = await createSessionCookie(uid);
  check('valid cookie reads back the user id', (await readSessionCookie(cookie)) === uid);
  check('undefined cookie -> null', (await readSessionCookie(undefined)) === null);
  check('empty cookie -> null', (await readSessionCookie('')) === null);
  check('garbage -> null', (await readSessionCookie('a.b.c')) === null);
  const [id, exp] = cookie.split('.');
  check('forged signature -> null', (await readSessionCookie(`${id}.${exp}.deadbeef`)) === null);
  check('swapped user id -> null', (await readSessionCookie(cookie.replace(id, '00000000-0000-0000-0000-000000000000'))) === null);
  const expired = `${uid}.${Date.now() - 1000}`;
  const { createHmac } = await import('node:crypto');
  const sig = createHmac('sha256', process.env.SESSION_SECRET!).update(expired).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  check('correctly-signed but expired -> null', (await readSessionCookie(`${expired}.${sig}`)) === null);

  section('Provisioning cursor');
  const all = flatQuestions();
  check(`flat list is ${TOTAL_QUESTIONS} questions`, all.length === TOTAL_QUESTIONS, `got ${all.length}`);
  check('globalOrder is 0..n-1 with no gaps', all.every((q, i) => q.globalOrder === i));
  check('every question has a section path', all.every((q) => !!q.sectionPath));
  check('every question has a heading', all.every((q) => !!q.headingName));
  check('every question has a name', all.every((q) => !!q.name.trim()));
  check('unique headings = 54', uniqueHeadings().length === 54, `got ${uniqueHeadings().length}`);
  // Chunking must cover every question exactly once.
  const seen = new Set<number>();
  for (let c = 0; c < all.length; c += 15) {
    for (let i = c; i < Math.min(c + 15, all.length); i++) seen.add(i);
  }
  check('chunks of 15 cover all questions exactly once', seen.size === all.length);
  check('source ids are unique per composite key',
    new Set(all.map((q) => `${q.sectionPath}|${q.headingOrder}|${q.order}|${q.sourceId}`)).size === all.length);

  section('Notion id parsing');
  check('full URL', normalizeNotionId('https://www.notion.so/My-Page-24f1b2c3d4e5f6a7b8c9d0e1f2a3b4c5') === '24f1b2c3-d4e5-f6a7-b8c9-d0e1f2a3b4c5');
  check('URL with query', normalizeNotionId('https://notion.so/Page-24f1b2c3d4e5f6a7b8c9d0e1f2a3b4c5?pvs=4') === '24f1b2c3-d4e5-f6a7-b8c9-d0e1f2a3b4c5');
  check('already dashed', normalizeNotionId('24f1b2c3-d4e5-f6a7-b8c9-d0e1f2a3b4c5') === '24f1b2c3-d4e5-f6a7-b8c9-d0e1f2a3b4c5');
  let threw = false;
  try { normalizeNotionId('not a notion link'); } catch { threw = true; }
  check('rejects junk with a clear error', threw);

  section('Day maths');
  check('shiftKey forward', shiftKey('2026-09-21', 1) === '2026-09-22');
  check('shiftKey backward', shiftKey('2026-09-21', -1) === '2026-09-20');
  check('shiftKey across month end', shiftKey('2026-09-30', 1) === '2026-10-01');
  check('shiftKey across year end', shiftKey('2026-12-31', 1) === '2027-01-01');
  check('shiftKey across leap day', shiftKey('2028-02-28', 1) === '2028-02-29');
  check('daysBetween', daysBetween('2026-09-01', '2026-09-21') === 20);
  check('formatKey keeps the same calendar day', formatKey('2026-09-21', 'yyyy-MM-dd') === '2026-09-21');
  // US DST ends 2026-11-01; IST has none, but the helpers must not drift either way.
  check('shiftKey across a DST boundary', shiftKey('2026-11-01', 1) === '2026-11-02');
  check('keyToDate is noon (DST-safe)', keyToDate('2026-09-21').getUTCHours() === 12);
  const grid = heatmapGrid('2026-09-21', 53);
  check('heatmap grid is 53 x 7', grid.length === 53 && grid.every((c) => c.length === 7));
  check('heatmap ends on/after today', grid[52][6] >= '2026-09-21');
  check('heatmap days are contiguous', grid.flat().every((d, i, a) => i === 0 || daysBetween(a[i - 1], d) === 1));
  check('every column starts on a Sunday (UTC)', grid.every((c) => keyToDate(c[0]).getUTCDay() === 0));
  check('today is in the last column', grid[52].includes('2026-09-21'));

  section('Derived stats');
  const t3 = [
    task({ id: '1', done: true, completedOn: '2026-09-19' }),
    task({ id: '2', done: true, completedOn: '2026-09-20' }),
    task({ id: '3', done: true, completedOn: '2026-09-20' }),
    task({ id: '4', done: false }),
  ];
  const c = countsByDay(t3);
  check('counts per day', c.get('2026-09-20') === 2 && c.get('2026-09-19') === 1);
  check('undone tasks are not counted', !c.has('null') && [...c.values()].reduce((a, b) => a + b, 0) === 3);
  const st = streaks(t3);
  check('longest streak spans consecutive days', st.longest === 2, `got ${st.longest}`);
  check('lastActive is the newest day', st.lastActive === '2026-09-20');
  check('streaks on empty input are zero', streaks([]).longest === 0 && streaks([]).current === 0);

  const ap = areaProgress([area({})], t3);
  check('areaProgress counts from tasks', ap[0].total === 4 && ap[0].done === 3);
  const op = overallProgress([area({})], t3);
  check('overallProgress matches', op.done === 3 && op.total === 4);
  check('paused areas excluded', overallProgress([area({ status: 'Paused' })], t3).total === 0);
  // Weighting: a heavier area should dominate the percentage.
  const w = overallProgress(
    [area({ id: 'a1', weight: 10 }), area({ id: 'a2', weight: 1 })],
    [
      task({ id: 'x', areaIds: ['a1'], done: true, completedOn: '2026-09-20' }),
      task({ id: 'y', areaIds: ['a2'], done: false }),
    ],
  );
  check('weights change the percentage', Math.round(w.pct) === 91, `got ${Math.round(w.pct)}`);
  check('empty areas give 0%, not NaN', overallProgress([], []).pct === 0);

  // -----------------------------------------------------------------------
  // Regression: a chunk that fails partway must report how far it really got.
  // Returning the cursor it started with made the next attempt re-create every
  // row already written, duplicating them in the user's Notion.
  // -----------------------------------------------------------------------
  section('seedChunk resume contract');
  {
    const realFetch = globalThis.fetch;
    let created = 0;
    const FAIL_ON = 6;

    globalThis.fetch = (async () => {
      created++;
      if (created === FAIL_ON) {
        return new Response(
          JSON.stringify({ object: 'error', status: 500, code: 'internal_server_error', message: 'boom' }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ object: 'page', id: `pg-${created}` }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const topicPageIds = Object.fromEntries(
        [...new Set(flatQuestions().map((q) => q.sectionPath))].map((p) => [p, 'topic-id']),
      );
      const r = await seedChunk(
        'ntn_fake',
        { tasksDs: 'ds', areaPageId: 'area', topicPageIds, headingIsSelect: true },
        0,
        10,
      );
      check('stops on the failing write', Boolean(r.error), `error=${r.error}`);
      check(
        `cursor equals rows actually written (${FAIL_ON - 1})`,
        r.cursor === FAIL_ON - 1,
        `got ${r.cursor}`,
      );
      check('does not claim completion', r.done === false);
      check('reports the real total', r.total === TOTAL_QUESTIONS);
      // The critical property: resuming from the reported cursor skips exactly
      // the rows that landed, and retries the one that failed.
      check('next attempt resumes on the failed row, not before', r.cursor === FAIL_ON - 1);
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  section('seedChunk bounds');
  {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ object: 'page', id: 'pg' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    try {
      const topicPageIds = Object.fromEntries(
        [...new Set(flatQuestions().map((q) => q.sectionPath))].map((p) => [p, 'topic-id']),
      );
      const d = { tasksDs: 'ds', areaPageId: 'area', topicPageIds, headingIsSelect: true };
      const past = await seedChunk('ntn_fake', d, TOTAL_QUESTIONS, 5);
      check('a cursor at the end reports done with no writes', past.done && past.cursor === TOTAL_QUESTIONS);
      const negative = await seedChunk('ntn_fake', d, -5, 2);
      check('a negative cursor is clamped to 0', negative.cursor === 2, `got ${negative.cursor}`);
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
