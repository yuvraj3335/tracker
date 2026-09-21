/**
 * Sample data for the dev-only design harness at /preview.
 *
 * Not a product feature: the route 404s outside development. It exists so the
 * UI can be reviewed and refined without a live Notion workspace, in every
 * skin and mode at once.
 */
import seed from '../../data/a2z-seed.json';
import type { Area, Task, Topic } from './notion';
import { shiftKey, todayKey } from './date';
import { DIFFICULTY } from './schema';

type Seed = typeof seed;

/** Deterministic, so the harness looks identical on every render. */
function mulberry(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AREA = 'fx-area-dsa';

let cache: { areas: Area[]; topics: Topic[]; tasks: Task[] } | null = null;

export function fixtures() {
  if (cache) return cache;
  const s = seed as Seed;
  const rand = mulberry(77);
  const today = todayKey();

  const topics: Topic[] = s.sections.map((sec) => ({
    id: `fx-topic-${sec.order}`,
    name: sec.name,
    order: sec.order,
    path: sec.path,
    areaIds: [AREA],
  }));

  const tasks: Task[] = [];
  let done = 0;
  const target = 163;

  for (const sec of s.sections) {
    for (const h of sec.headings) {
      for (const q of h.questions) {
        const isDone = done < target && rand() > 0.1;
        if (isDone) done++;
        tasks.push({
          id: `fx-task-${q.globalOrder}`,
          name: q.name,
          done: isDone,
          completedOn: isDone
            ? shiftKey(today, -Math.min(Math.floor((1 - done / target) * 90) + Math.floor(rand() * 4), 98))
            : null,
          areaIds: [AREA],
          topicIds: [`fx-topic-${sec.order}`],
          heading: h.name,
          difficulty: rand() > 0.4 ? DIFFICULTY[Math.floor(rand() * 3)] : null,
          order: q.globalOrder,
          headingOrder: h.order,
          taskOrder: q.order,
          links: {
            tuf: q.tufLink,
            leetcode: q.leetCodeLink,
            gfg: q.gfgLink,
            youtube: q.youTubeLink,
          },
          bookmarked: rand() > 0.93,
          revisit: rand() > 0.95,
          notes: '',
          sourceId: q.sourceId,
        });
      }
    }
  }

  // Guarantee a live streak and something completed today.
  const recent = tasks.filter((t) => t.done).sort((a, b) => (a.completedOn! < b.completedOn! ? 1 : -1));
  recent.slice(0, 5).forEach((t) => { t.completedOn = today; });
  recent.slice(5, 26).forEach((t, i) => { t.completedOn = shiftKey(today, -(1 + Math.floor(i / 3))); });

  const areas: Area[] = [
    { id: AREA, name: 'DSA', slug: 'dsa', emoji: '🧩', weight: 1, status: 'Active', order: 0 },
    { id: 'fx-area-lld', name: 'Low Level Design', slug: 'lld', emoji: '🏗️', weight: 1, status: 'Planned', order: 1 },
  ];

  cache = { areas, topics, tasks };
  return cache;
}
