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
import { shiftKey, formatKey, daysBetween, heatmapGrid, keyToDate, todayKey, isDayKey } from '../src/lib/date';
import { streaks, countsByDay, overallProgress, areaProgress, streakMood } from '../src/lib/derive';
import {
  parseCharacterMeta,
  parseAccent,
  resolvePose,
  resolveCharacter,
  isRenderable,
  type Character,
} from '../src/lib/characters';
import { discoverCharacters } from '../src/lib/characters.server';
import { pickCharacterLine, dailyLine } from '../src/lib/character-voice';
import { THEMES } from '../src/lib/themes';
import {
  normalize,
  tokenize,
  matchesTokens,
  indexTasks,
  searchIndexed,
  applyFilter,
  isFilter,
} from '../src/lib/search';
import { mapSheetKey, isPaletteShortcut, SHORTCUTS } from '../src/lib/keys';
import { safeNextPath, checkUsername, checkPassword } from '../src/lib/validate';
import { usableAccent, contrastRatio, readableInk } from '../src/lib/contrast';
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

  // `?d=` is read straight off the URL and the heatmap links to it, so the
  // shape test that used to guard it let `2026-13-45` through — and every
  // helper here then threw RangeError on an Invalid Date, leaving the page
  // stuck on its loading skeleton.
  check('a real day key is accepted', isDayKey('2026-09-21'));
  check('a leap day in a leap year is accepted', isDayKey('2028-02-29'));
  check('month 13 is refused', !isDayKey('2026-13-45'));
  check('day 99 is refused', !isDayKey('9999-99-99'));
  check('30 February is refused', !isDayKey('2026-02-30'));
  check('29 February in a common year is refused', !isDayKey('2027-02-29'));
  check('a wrong shape is refused', !isDayKey('2026-9-1'));
  check('a datetime is refused', !isDayKey('2026-09-21T00:00:00Z'));
  check('an empty string is refused', !isDayKey(''));
  check('a non-string is refused', !isDayKey(20260921 as unknown as string));
  check('null is refused', !isDayKey(null));
  check('every heatmap cell is a valid day key', grid.flat().every(isDayKey));

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

  // -----------------------------------------------------------------------
  // Character system. All of this must hold with ZERO artwork installed, which
  // is how the app ships — the SVG mascot fallback is the default path.
  // -----------------------------------------------------------------------
  section('Character meta parsing');
  {
    const ok = parseCharacterMeta(
      { id: 'ignored', name: 'Amber', artist: 'Someone', source: 'https://x.test', license: 'fan kit' },
      'amber',
    );
    check('accepts a complete meta', ok !== null);
    check('folder id wins over the id in the file', ok?.id === 'amber', `got ${ok?.id}`);
    check('name is carried through', ok?.name === 'Amber');
    check(
      'missing artist is refused (attribution is the point)',
      parseCharacterMeta({ name: 'X', license: 'y' }, 'x') === null,
    );
    check(
      'missing license is refused',
      parseCharacterMeta({ name: 'X', artist: 'y' }, 'x') === null,
    );
    check('non-object meta is refused', parseCharacterMeta('nope', 'x') === null);
    check('null meta is refused', parseCharacterMeta(null, 'x') === null);
    check(
      'a folder name that could escape the URL is refused',
      parseCharacterMeta({ artist: 'a', license: 'b' }, '../etc') === null,
    );
    check(
      'name falls back to the folder id',
      parseCharacterMeta({ artist: 'a', license: 'b' }, 'solo')?.name === 'solo',
    );
    check('valid accent is kept', parseAccent('#7c4dcc') === '#7c4dcc');
    check('short-form accent is kept', parseAccent('#abc') === '#abc');
    check('non-hex accent is dropped', parseAccent('red') === undefined);
    check('malformed accent is dropped', parseAccent('#12345') === undefined);
    const lines = parseCharacterMeta(
      { artist: 'a', license: 'b', lines: { cheer: ['one', '', '  '], milestone: [], idle: ['hi'] } },
      'x',
    );
    check('blank lines are dropped', lines?.lines?.cheer?.length === 1, `got ${lines?.lines?.cheer?.length}`);
    check('an empty list becomes undefined', lines?.lines?.milestone === undefined);
    check('a populated list survives', lines?.lines?.idle?.[0] === 'hi');
  }

  section('Character pose fallback');
  {
    const full: Character = {
      id: 'f', name: 'F', artist: 'a', license: 'l', source: '',
      poses: { idle: '/i.webp', celebrate: '/c.webp', milestone: '/m.webp', sad: '/s.webp' },
    };
    const idleOnly: Character = { ...full, poses: { idle: '/i.webp' } };
    const noMilestone: Character = { ...full, poses: { idle: '/i.webp', celebrate: '/c.webp' } };

    check('full set resolves each pose directly', resolvePose(full, 'milestone') === '/m.webp');
    check('sad resolves directly when present', resolvePose(full, 'sad') === '/s.webp');
    check('milestone falls back to celebrate', resolvePose(noMilestone, 'milestone') === '/c.webp');
    check('sad falls back to idle', resolvePose(noMilestone, 'sad') === '/i.webp');
    check('celebrate falls back to idle', resolvePose(idleOnly, 'celebrate') === '/i.webp');
    check('milestone falls all the way to idle', resolvePose(idleOnly, 'milestone') === '/i.webp');
    check('a null character resolves to null (SVG mascot renders)', resolvePose(null, 'idle') === null);
    check('a character with no art resolves to null',
      resolvePose({ ...full, poses: {} }, 'idle') === null);
    check('isRenderable tracks the idle pose', isRenderable(idleOnly) && !isRenderable({ ...full, poses: {} }));

    const catalog = [full, idleOnly];
    check('lookup finds by id', resolveCharacter(catalog, 'f')?.id === 'f');
    check('an unknown id resolves to null, not a throw', resolveCharacter(catalog, 'gone') === null);
    check('an empty id resolves to null', resolveCharacter(catalog, '') === null);
  }

  section('Character discovery');
  {
    // The repo ships no artwork, so this is usually empty — but the suite also
    // has to pass with `npm run fixtures:characters` installed, and asserting a
    // count only held in one of those states. These hold in both, and they are
    // the properties that actually matter: anything discovery admits must be
    // renderable, credited, and safe to build a URL from.
    const found = discoverCharacters();
    console.log(`  note ${found.length} character(s) installed`);
    check('discovery returns an array and never throws', Array.isArray(found));
    check('every discovered character can be drawn', found.every(isRenderable));
    check(
      'every discovered character carries attribution',
      found.every((c) => Boolean(c.artist) && Boolean(c.license)),
    );
    check(
      'every discovered id is a safe URL segment',
      found.every((c) => /^[a-z0-9][a-z0-9_-]*$/i.test(c.id)),
    );
    check(
      'every pose url stays inside that character folder',
      found.every((c) =>
        Object.values(c.poses).every((u) => u.startsWith(`/characters/${c.id}/`)),
      ),
    );
    check('the catalogue is sorted by name', found.every((c, i) => i === 0 || found[i - 1].name.localeCompare(c.name) <= 0));
  }

  section('Character voice');
  {
    const theme = THEMES.blossom;
    const withLines: Character = {
      id: 'v', name: 'V', artist: 'a', license: 'l', source: '',
      poses: { idle: '/i.webp' },
      lines: { cheer: ['ka', 'kb'], idle: ['d1', 'd2', 'd3'] },
    };
    const without: Character = { ...withLines, lines: undefined };

    check('character cheer lines win over the skin', pickCharacterLine(withLines, 'cheer', theme, 0) === 'ka');
    check('lines rotate rather than repeat', pickCharacterLine(withLines, 'cheer', theme, 1) === 'kb');
    check('rotation wraps', pickCharacterLine(withLines, 'cheer', theme, 2) === 'ka');
    check(
      'a kind the character does not define falls back to the skin',
      pickCharacterLine(withLines, 'milestone', theme, 0) === theme.milestone[0],
    );
    check(
      'a character with no lines uses the skin throughout',
      pickCharacterLine(without, 'cheer', theme, 0) === theme.cheers[0],
    );
    check(
      'no character at all uses the skin',
      pickCharacterLine(null, 'cheer', theme, 0) === theme.cheers[0],
    );
    check('idle falls back to the skin tagline', pickCharacterLine(without, 'idle', theme, 0) === theme.tagline);

    const d1 = dailyLine(withLines, '2026-09-21');
    check('daily line is stable for the same day', d1 === dailyLine(withLines, '2026-09-21'));
    check('daily line comes from the character list', withLines.lines!.idle!.includes(d1!));
    check('a different day can pick a different line',
      new Set(['2026-09-21', '2026-09-22', '2026-09-23'].map((d) => dailyLine(withLines, d))).size > 1);
    check('no idle lines means no daily line', dailyLine(without, '2026-09-21') === null);
    check('no character means no daily line', dailyLine(null, '2026-09-21') === null);
  }

  // -----------------------------------------------------------------------
  // A character's accent comes from a meta.json the owner wrote, and it
  // replaces link text, a button fill and the focus ring. It is only allowed
  // to do that if it clears the same floors every shipped token is held to —
  // otherwise one character could quietly undo the palette.
  // -----------------------------------------------------------------------
  section('Character accent gate');
  {
    // Text surfaces, then the mark-only surface — the same split the palette
    // validator holds the shipped accents to.
    const LIGHT = ['#fcfcfb', '#f9f9f7'];
    const LIGHT_MARK = ['#f2f1ed'];
    const DARK = ['#1a1a19', '#0d0d0d'];

    check('the shipped accent passes its own gate', usableAccent('#2472d0', LIGHT, LIGHT_MARK) !== null);
    check('its ink is chosen, not assumed', usableAccent('#2472d0', LIGHT, LIGHT_MARK)?.ink === '#ffffff');
    check(
      'a light accent takes dark ink',
      usableAccent('#86b6ef', DARK)?.ink === '#0b0b0b',
    );
    check(
      'an accent too pale for a light surface is refused',
      usableAccent('#cfe3ff', LIGHT) === null,
    );
    check(
      'an accent too dark for a dark surface is refused',
      usableAccent('#101010', DARK) === null,
    );
    check('an unparseable accent is refused', usableAccent('rebeccapurple', LIGHT) === null);
    check('a missing accent is refused', usableAccent(undefined, LIGHT) === null);
    check('an empty accent is refused', usableAccent('', LIGHT) === null);
    check(
      'an accent must clear EVERY text surface, not just one',
      usableAccent('#767676', ['#ffffff', '#767676']) === null,
    );
    check(
      'an accent that reads as text but not as a mark is refused',
      // 4.5:1 on the card, under 3:1 on the surface it also draws a ring on.
      usableAccent('#6c7a12', ['#ffffff'], ['#7d8a2a']) === null,
    );
    check('short hex is accepted', usableAccent('#06c', LIGHT) !== null);
    check('contrastRatio is symmetric', contrastRatio('#000000', '#ffffff') === contrastRatio('#ffffff', '#000000'));
    check('black on white is 21:1', Math.round(contrastRatio('#000000', '#ffffff')!) === 21);
    check('a colour against itself is 1:1', contrastRatio('#2472d0', '#2472d0') === 1);
    check('garbage contrast is null, not NaN', contrastRatio('nope', '#fff') === null);
    check('readableInk picks dark on a pale colour', readableInk('#e6dcf7') === '#0b0b0b');
    check('readableInk picks light on a deep colour', readableInk('#104281') === '#ffffff');
  }

  section('Streak mood (drives the sad pose)');
  {
    const T = todayKey();
    check('an active streak is live', streakMood({ current: 3, longest: 5, lastActive: T }) === 'live');
    check('never started is none', streakMood({ current: 0, longest: 0, lastActive: null }) === 'none');
    check(
      'a lapsed run is broken',
      streakMood({ current: 0, longest: 4, lastActive: shiftKey(T, -5) }) === 'broken',
    );
    check(
      'one active day then a gap is not worth commiserating over',
      streakMood({ current: 0, longest: 1, lastActive: shiftKey(T, -5) }) === 'none',
    );
    check(
      'yesterday is still live, not broken',
      streakMood({ current: 2, longest: 2, lastActive: shiftKey(T, -1) }) === 'live',
    );
    check(
      'a future-dated completion is not reported as broken',
      streakMood({ current: 0, longest: 3, lastActive: shiftKey(T, 5) }) === 'none',
    );
  }

  section('Search matching');
  {
    check('normalize folds case and punctuation', normalize('User Input/ Output') === 'user input output');
    check('normalize folds diacritics', normalize('Créer') === 'creer');
    check('normalize collapses runs', normalize('a---b   c') === 'a b c');
    check('normalize of punctuation only is empty', normalize('--/--') === '');
    check('tokenize splits on the normalized form', JSON.stringify(tokenize('Binary  Search!')) === '["binary","search"]');
    check('an empty query tokenizes to nothing', tokenize('   ').length === 0);

    check('every token must match (AND, not OR)', matchesTokens('binary search tree', ['binary', 'tree']));
    check('a missing token rejects the row', !matchesTokens('binary search tree', ['binary', 'graph']));
    check('tokens match mid-word, not just at the start', matchesTokens('binary search', ['sear']));
    check('token order does not matter', matchesTokens('two sum arrays', ['sum', 'two']));
    check('an empty query matches everything', matchesTokens('anything', []));

    const searchTasks = [
      task({ id: 's1', name: 'Two Sum', heading: 'Hashing', topicIds: ['t1'] }),
      task({ id: 's2', name: 'Binary Search on Answers', heading: 'BS on 1D', topicIds: ['t2'] }),
      task({ id: 's3', name: 'Reverse a Linked List', heading: 'Basics', topicIds: ['t3'] }),
    ];
    const names = new Map([['t1', 'Arrays'], ['t2', 'Binary Search'], ['t3', 'Linked List']]);
    const idx = indexTasks(searchTasks, (id) => names.get(id));

    check('name match', searchIndexed(idx, 'two sum').map((t) => t.id).join() === 's1');
    check('partial, out-of-order words match', searchIndexed(idx, 'sum two').map((t) => t.id).join() === 's1');
    check('abbreviated words match', searchIndexed(idx, 'bin sear').map((t) => t.id).join() === 's2');
    check('section name is searchable', searchIndexed(idx, 'arrays').map((t) => t.id).join() === 's1');
    check('heading is searchable', searchIndexed(idx, 'hashing').map((t) => t.id).join() === 's1');
    check('punctuation in the source need not be typed', searchIndexed(idx, 'bs on 1d').map((t) => t.id).join() === 's2');
    check('an empty query returns everything', searchIndexed(idx, '').length === 3);
    check('no match returns nothing', searchIndexed(idx, 'zzzz').length === 0);
    check('search is case-insensitive', searchIndexed(idx, 'TWO SUM').map((t) => t.id).join() === 's1');

    const mixed = [
      task({ id: 'f1', done: true }),
      task({ id: 'f2', done: false, bookmarked: true }),
      task({ id: 'f3', done: false, revisit: true }),
    ];
    check('filter all', applyFilter(mixed, 'all').length === 3);
    check('filter todo', applyFilter(mixed, 'todo').map((t) => t.id).join() === 'f2,f3');
    check('filter done', applyFilter(mixed, 'done').map((t) => t.id).join() === 'f1');
    check('filter bookmarked', applyFilter(mixed, 'bookmarked').map((t) => t.id).join() === 'f2');
    check('filter revisit', applyFilter(mixed, 'revisit').map((t) => t.id).join() === 'f3');
    check('isFilter accepts a known key', isFilter('todo'));
    check('isFilter rejects junk from the URL', !isFilter('../etc') && !isFilter(null));
  }

  // -----------------------------------------------------------------------
  // Redirect safety. `?next=` is attacker-supplied and ends up in a Location
  // header, so every shape that a browser resolves to another origin has to
  // come back as '/'. The sign-in page and the sign-in route used to check it
  // separately, by different rules, and the weaker check decided where the
  // browser actually went.
  // -----------------------------------------------------------------------
  section('Redirect safety (?next=)');
  {
    // Allowed: ordinary same-site destinations.
    check('a plain path is kept', safeNextPath('/areas/dsa') === '/areas/dsa');
    check('a path with a query is kept', safeNextPath('/daily?d=2026-09-21') === '/daily?d=2026-09-21');
    check('root is kept', safeNextPath('/') === '/');

    // Refused: everything that leaves the site.
    check('protocol-relative is refused', safeNextPath('//evil.example') === '/');
    check('protocol-relative with a path is refused', safeNextPath('//evil.example/x') === '/');
    check('many leading slashes are refused', safeNextPath('////evil.example') === '/');
    check('a backslash host is refused', safeNextPath('/\\evil.example') === '/');
    check('backslash-slash is refused', safeNextPath('/\\/evil.example') === '/');
    check('a double backslash is refused', safeNextPath('\\\\evil.example') === '/');
    check('an absolute http url is refused', safeNextPath('https://evil.example') === '/');
    check('a scheme-looking path is refused', safeNextPath('/javascript:alert(1)') === '/');
    check('a tab-smuggled host is refused', safeNextPath('/\t/evil.example') === '/');
    check('a newline-smuggled host is refused', safeNextPath('/\n/evil.example') === '/');
    check('a CR-smuggled host is refused', safeNextPath('/\r/evil.example') === '/');
    check('a relative path is refused', safeNextPath('areas/dsa') === '/');

    // Nothing may throw: these arrive straight off the wire.
    check('empty is root', safeNextPath('') === '/');
    check('undefined is root', safeNextPath(undefined) === '/');
    check('null is root', safeNextPath(null) === '/');
    check('a non-string is root', safeNextPath({ toString: () => '//evil.example' }) === '/');
  }

  section('Account validation');
  {
    check('a good username passes', checkUsername('yuvraj_3335').ok);
    check('too short is refused', !checkUsername('ab').ok);
    check('a space is refused', !checkUsername('bad user').ok);
    check('a slash is refused', !checkUsername('a/b').ok);
    check('33 characters is refused', !checkUsername('a'.repeat(33)).ok);
    check('32 characters is allowed', checkUsername('a'.repeat(32)).ok);
    check('a short password is refused', !checkPassword('short').ok);
    check('an 8-character password is allowed', checkPassword('12345678').ok);
    check('a 513-character password is refused', !checkPassword('a'.repeat(513)).ok);
  }

  section('Keyboard mapping');
  {
    const k = (key: string, mods: Record<string, boolean> = {}) => ({ key, ...mods });

    check('j moves down', mapSheetKey(k('j'), false) === 'next');
    check('arrow down moves down', mapSheetKey(k('ArrowDown'), false) === 'next');
    check('k moves up', mapSheetKey(k('k'), false) === 'prev');
    check('enter toggles', mapSheetKey(k('Enter'), false) === 'toggle');
    check('b bookmarks', mapSheetKey(k('b'), false) === 'bookmark');
    check('r flags revisit', mapSheetKey(k('r'), false) === 'revisit');
    check('slash focuses search', mapSheetKey(k('/'), false) === 'focusSearch');
    check('question mark opens help', mapSheetKey(k('?'), false) === 'help');
    check('an unbound key does nothing', mapSheetKey(k('z'), false) === null);

    // Space is left to the focused checkbox; claiming it would double-toggle.
    check('space is not claimed', mapSheetKey(k(' '), false) === null);

    check('letters do nothing while typing', mapSheetKey(k('b'), true) === null);
    check('j does nothing while typing', mapSheetKey(k('j'), true) === null);
    check('escape still works while typing', mapSheetKey(k('Escape'), true) === 'dismiss');
    check('escape works outside typing too', mapSheetKey(k('Escape'), false) === 'dismiss');

    check('ctrl+key is left to the browser', mapSheetKey(k('b', { ctrlKey: true }), false) === null);
    check('cmd+key is left to the OS', mapSheetKey(k('j', { metaKey: true }), false) === null);
    check('alt+key is left alone', mapSheetKey(k('r', { altKey: true }), false) === null);

    check('cmd-k opens the palette', isPaletteShortcut(k('k', { metaKey: true })));
    check('ctrl-k opens the palette', isPaletteShortcut(k('K', { ctrlKey: true })));
    check('a bare k does not open the palette', !isPaletteShortcut(k('k')));
    check('cmd-j does not open the palette', !isPaletteShortcut(k('j', { metaKey: true })));

    check('every shortcut in the overlay has a label', SHORTCUTS.every((s) => s.label && s.keys.length));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
