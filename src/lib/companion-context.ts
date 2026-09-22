/**
 * What the companion is allowed to know about you.
 *
 * Everything here is derived through derive.ts rather than recounted, so the
 * numbers the companion says out loud are the same numbers the dashboard
 * shows. That is the whole point: an app built on one honest source of truth
 * cannot have a companion quoting a second one.
 *
 * Compact on purpose. This goes into the system prompt on every turn, so it is
 * a few hundred tokens of facts rather than a dump of 456 rows — the model
 * needs the shape of their progress, not the sheet.
 */
import type { Area, Task, Topic } from './notion';
import {
  areaProgress,
  difficultyBreakdown,
  performanceMood,
  summarize,
  topicProgress,
} from './derive';
import { daysBetween, todayKey } from './date';
import { pct } from './utils';

/** How many section and question names are worth naming out loud. */
const NAMED_SECTIONS = 4;
const NAMED_NEXT = 3;

const list = (names: string[], limit: number): string => {
  const shown = names.slice(0, limit);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ');
};

/**
 * A plain-English snapshot of where someone actually is.
 *
 * Written as sentences rather than JSON because it is read by a model that is
 * about to speak: facts phrased the way a person would say them come back out
 * sounding like a person, and a table comes back out sounding like a table.
 */
export function buildSnapshot(areas: Area[], topics: Topic[], tasks: Task[]): string {
  const stats = summarize(areas, tasks);
  const mood = performanceMood(tasks, stats);
  const lines: string[] = [];

  lines.push(
    `Overall they have done ${stats.overall.done} of ${stats.overall.total} questions (${pct(stats.overall.done, stats.overall.total)}%).`,
  );
  lines.push(
    `Today: ${stats.todayCount}. Last seven days: ${stats.last7Total}. Current streak: ${stats.streak.current} ${stats.streak.current === 1 ? 'day' : 'days'} (longest ever ${stats.streak.longest}). Days with any activity: ${stats.activeDays}.`,
  );

  if (stats.streak.lastActive) {
    const gap = daysBetween(stats.streak.lastActive, todayKey());
    lines.push(
      gap <= 0
        ? 'They have logged something today.'
        : `Last logged something ${gap} ${gap === 1 ? 'day' : 'days'} ago.`,
    );
  } else {
    lines.push('They have never logged a question yet.');
  }

  // Difficulty. The source sheet ships none of this, so most of it is usually
  // blank — saying so is the difference between honest and confidently wrong.
  const diff = difficultyBreakdown(tasks);
  const graded = diff.rows.map((r) => `${r.difficulty} ${r.done}/${r.total}`).join(', ');
  lines.push(
    `By difficulty (done out of total): ${graded}. ${diff.unset.total} questions have no difficulty set` +
      (diff.unset.total > 0
        ? ' — the source sheet does not carry difficulty, so it is blank until they fill it in.'
        : '.'),
  );

  const areasText = areaProgress(areas, tasks)
    .filter((a) => a.total > 0)
    .map((a) => `${a.area.name} ${a.done}/${a.total} (${Math.round(a.pct)}%)`)
    .join('; ');
  if (areasText) lines.push(`Areas: ${areasText}.`);

  // Sections, split by how far in they are. "What am I working on" is the
  // single most likely question and this is the answer to it.
  const sections = topicProgress(topics, tasks);
  const inProgress = sections.filter((t) => t.done > 0 && t.done < t.total);
  const finished = sections.filter((t) => t.total > 0 && t.done === t.total);
  const untouched = sections.filter((t) => t.total > 0 && t.done === 0);

  if (inProgress.length) {
    lines.push(
      `Currently part-way through: ${list(inProgress.map((t) => `${t.topic.name} (${t.done}/${t.total})`), NAMED_SECTIONS)}.`,
    );
  }
  if (finished.length) {
    lines.push(`Finished sections: ${list(finished.map((t) => t.topic.name), NAMED_SECTIONS)}.`);
  }
  if (untouched.length) {
    lines.push(`Not started yet: ${list(untouched.map((t) => t.topic.name), NAMED_SECTIONS)}.`);
  }

  const next = tasks.filter((t) => !t.done).slice(0, NAMED_NEXT);
  if (next.length) {
    lines.push(`Next few questions in sheet order: ${next.map((t) => `"${t.name}"`).join(', ')}.`);
  } else if (stats.overall.total > 0) {
    lines.push('They have finished every question.');
  }

  const bookmarked = tasks.filter((t) => t.bookmarked).length;
  const revisit = tasks.filter((t) => t.revisit).length;
  if (bookmarked || revisit) {
    lines.push(`They have bookmarked ${bookmarked} and flagged ${revisit} to revisit.`);
  }

  // The same reading the dashboard banner is drawing, so the companion and the
  // banner never say different things about the same week.
  const reading =
    mood.key === 'strong'
      ? 'Going well — a live streak with something logged today.'
      : mood.key === 'slipping' && mood.cause === 'streak-broken'
        ? 'A run recently lapsed.'
        : mood.key === 'slipping'
          ? 'Their pace has dropped well below their own recent average.'
          : 'Nothing notable either way right now.';
  lines.push(`How it is going: ${reading}`);

  return lines.join('\n');
}
