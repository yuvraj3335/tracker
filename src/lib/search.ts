/**
 * Client-side search over the sheet.
 *
 * The whole list is already in memory — reading a tracker is five paginated
 * Notion calls and the page has all 456 rows — so filtering is a local array
 * pass with no request and no debounce needed. That is the entire reason this
 * can be instant.
 *
 * Matching is token-AND over a precomputed haystack rather than one substring
 * test, because the useful queries are partial and out of order: "bin search"
 * should find "Binary Search", and "arr two sum" should find "Two Sum" inside
 * the Arrays section. A single `includes` finds neither.
 */
import type { Task } from './notion';

/**
 * Lowercases and flattens anything that is not a letter or digit to a single
 * space, so punctuation in the source names ("User Input/ Output",
 * "Left/Right") never has to be typed exactly. Diacritics are folded via NFD so
 * an ASCII query still matches an accented name.
 */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Query tokens, in the order typed. An empty or punctuation-only query is []. */
export function tokenize(query: string): string[] {
  const n = normalize(query);
  return n ? n.split(' ') : [];
}

/**
 * True when every token appears somewhere in the haystack.
 *
 * AND rather than OR: each extra word should narrow the list. Substring rather
 * than prefix, so "search" matches "Binary Search" without typing the first
 * word.
 */
export function matchesTokens(haystack: string, tokens: readonly string[]): boolean {
  if (!tokens.length) return true;
  for (const t of tokens) if (!haystack.includes(t)) return false;
  return true;
}

/** A task plus the normalized text it is searched against. */
export type Searchable<T> = { item: T; haystack: string };

/**
 * Precomputes the haystack for each row once.
 *
 * Normalizing 456 names on every keystroke would be wasted work; this runs once
 * per data change and every keystroke is then a plain substring scan.
 */
export function indexTasks(
  tasks: readonly Task[],
  topicName: (id: string) => string | undefined,
): Searchable<Task>[] {
  return tasks.map((item) => ({
    item,
    // Name, heading and section all searchable, so "arrays" finds a section's
    // worth of questions and "sliding window" finds a heading's.
    haystack: normalize(
      [item.name, item.heading, ...item.topicIds.map((id) => topicName(id) ?? '')].join(' '),
    ),
  }));
}

export function searchIndexed<T>(rows: readonly Searchable<T>[], query: string): T[] {
  const tokens = tokenize(query);
  if (!tokens.length) return rows.map((r) => r.item);
  const out: T[] = [];
  for (const r of rows) if (matchesTokens(r.haystack, tokens)) out.push(r.item);
  return out;
}

// ---------------------------------------------------------------------------
// Status filter — the chips above the sheet.
// ---------------------------------------------------------------------------
export const FILTERS = ['all', 'todo', 'done', 'bookmarked', 'revisit'] as const;
export type Filter = (typeof FILTERS)[number];

export function isFilter(v: unknown): v is Filter {
  return typeof v === 'string' && (FILTERS as readonly string[]).includes(v);
}

export function applyFilter(tasks: readonly Task[], f: Filter): Task[] {
  switch (f) {
    case 'todo':
      return tasks.filter((t) => !t.done);
    case 'done':
      return tasks.filter((t) => t.done);
    case 'bookmarked':
      return tasks.filter((t) => t.bookmarked);
    case 'revisit':
      return tasks.filter((t) => t.revisit);
    default:
      return tasks as Task[];
  }
}
