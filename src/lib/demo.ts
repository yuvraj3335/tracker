/**
 * Demo data, built from the real scraped sheet.
 *
 * Set DEMO_MODE=1 to browse the whole app with plausible progress and no
 * Notion connection at all — handy for previewing a deploy before the
 * databases exist. Every value is deterministic, so renders don't flicker.
 *
 * Nothing here ever touches Notion, and it is bypassed entirely once
 * NOTION_TOKEN and the data source ids are set (unless DEMO_MODE is on).
 */
import seed from '../../data/a2z-seed.json';
import type { Area, Task, Topic } from './notion';
import { shiftKey, todayKey } from './date';
import { DIFFICULTY } from './schema';

type Seed = typeof seed;

/** Small deterministic PRNG so the demo looks the same on every render. */
function mulberry(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AREA_ID = 'demo-area-dsa';

let cache: { areas: Area[]; topics: Topic[]; tasks: Task[] } | null = null;

export function demoData() {
  if (cache) return cache;

  const s = seed as Seed;
  const rand = mulberry(20260921);
  const today = todayKey();

  const topics: Topic[] = s.sections.map((sec) => ({
    id: `demo-topic-${sec.order}`,
    name: sec.name,
    order: sec.order,
    path: sec.path,
    areaIds: [AREA_ID],
    total: null,
    done: null,
    progress: null,
  }));

  const tasks: Task[] = [];
  // Work through the sheet in order, completing a decreasing share of it so
  // the early sections look finished and the later ones untouched.
  let globalDone = 0;
  const target = 148;

  for (const sec of s.sections) {
    for (const h of sec.headings) {
      for (const q of h.questions) {
        const inRange = globalDone < target;
        const done = inRange && rand() > 0.12;
        if (done) globalDone++;

        // Spread completions over the last ~14 weeks, front-loaded, with
        // occasional rest days so the heatmap has texture.
        let completedOn: string | null = null;
        if (done) {
          const ago = Math.floor((1 - globalDone / target) * 96) + Math.floor(rand() * 5);
          completedOn = shiftKey(today, -Math.min(ago, 99));
        }

        tasks.push({
          id: `demo-task-${q.globalOrder}`,
          name: q.name,
          done,
          completedOn,
          areaIds: [AREA_ID],
          topicIds: [`demo-topic-${sec.order}`],
          heading: h.name,
          // Demo only — the real seed leaves difficulty blank, because the
          // source sheet does not carry it.
          difficulty: rand() > 0.45 ? DIFFICULTY[Math.floor(rand() * 3)] : null,
          order: q.globalOrder,
          headingOrder: h.order,
          taskOrder: q.order,
          links: {
            tuf: q.tufLink,
            leetcode: q.leetCodeLink,
            gfg: q.gfgLink,
            youtube: q.youTubeLink,
          },
          bookmarked: rand() > 0.94,
          revisit: rand() > 0.96,
          notes: '',
          sourceId: q.sourceId,
        });
      }
    }
  }

  // Pull the newest handful onto today so the preview exercises the
  // "what you did today" path and shows a live streak.
  const completed = tasks
    .filter((t) => t.done && t.completedOn)
    .sort((a, b) => (a.completedOn! < b.completedOn! ? 1 : -1));
  completed.slice(0, 4).forEach((t) => { t.completedOn = today; });
  // Guarantee an unbroken run into today rather than a lucky one.
  completed.slice(4, 22).forEach((t, i) => {
    t.completedOn = shiftKey(today, -(1 + Math.floor(i / 3)));
  });

  const done = tasks.filter((t) => t.done).length;
  const areas: Area[] = [
    {
      id: AREA_ID,
      name: 'DSA',
      slug: 'dsa',
      emoji: '🧩',
      weight: 1,
      status: 'Active',
      order: 0,
      total: tasks.length,
      done,
      progress: done / tasks.length,
    },
    // A second area, to show that overall progress folds new areas in.
    {
      id: 'demo-area-lld',
      name: 'Low Level Design',
      slug: 'lld',
      emoji: '🏗️',
      weight: 1,
      status: 'Planned',
      order: 1,
      total: 0,
      done: 0,
      progress: 0,
    },
  ];

  cache = { areas, topics, tasks };
  return cache;
}

export function isDemo() {
  return process.env.DEMO_MODE === '1';
}
