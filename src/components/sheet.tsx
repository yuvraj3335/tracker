'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Search, X, Rows3, Rows4, Keyboard, Check } from 'lucide-react';
import { Card } from './ui/card';
import { HeadingBand } from './heading-band';
import { ProgressBar } from './progress-bar';
import { TaskRow } from './task-row';
import { CharacterFigure } from './character-figure';
import { ShortcutsOverlay } from './shortcuts-overlay';
import { publishCommands } from '@/lib/commands';
import { getDensity, serverDensity, setDensity, subscribe } from '@/lib/appearance';
import { applyFilter, indexTasks, isFilter, searchIndexed, type Filter } from '@/lib/search';
import { isTypingTarget, mapSheetKey } from '@/lib/keys';
import { groupByHeading } from '@/lib/derive';
import type { Task, Topic } from '@/lib/notion';
import { pct } from '@/lib/utils';
import { cn } from '@/lib/utils';

/**
 * The 456-question sheet.
 *
 * Everything here is client-side over data the page already loaded. Filtering
 * used to be a link with `?f=`, which meant a full server round trip — and five
 * paginated Notion calls — to hide some rows that were already on screen.
 * Search did not exist at all, which on a list this long was the single biggest
 * thing missing.
 *
 * Performance notes, because this renders up to 456 rows:
 *  - Haystacks are normalized once in `indexTasks`, not per keystroke.
 *  - The query is passed through `useDeferredValue`, so typing stays responsive
 *    while the big list re-filters at a lower priority.
 *  - Keyboard focus is tracked as one index and resolved with a single DOM
 *    query on change. No per-row refs, observers or timers — there is exactly
 *    one keydown listener for the whole sheet.
 */
export function Sheet({
  topics,
  tasks,
  areaName,
  initialFilter,
}: {
  topics: Topic[];
  tasks: Task[];
  areaName: string;
  initialFilter?: string;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>(isFilter(initialFilter) ? initialFilter : 'all');
  const [cursor, setCursor] = useState(-1);
  const [help, setHelp] = useState(false);
  const density = useSyncExternalStore(subscribe, getDensity, serverDensity);
  const searchBox = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);

  // Typing stays on the urgent path; re-filtering 456 rows happens at lower
  // priority, so the input never stutters.
  const deferredQuery = useDeferredValue(query);

  const topicName = useMemo(() => {
    const m = new Map(topics.map((t) => [t.id, t.name]));
    return (id: string) => m.get(id);
  }, [topics]);

  const index = useMemo(() => indexTasks(tasks, topicName), [tasks, topicName]);

  // Status filter first, then text. Both are cheap passes over the same array.
  // `searched` is kept because the filter chips need the same set to count
  // against; recomputing it per chip meant five extra scans of 456 rows on
  // every render, on the path that is already the expensive one.
  const searched = useMemo(() => searchIndexed(index, deferredQuery), [index, deferredQuery]);
  const visible = useMemo(() => applyFilter(searched, filter), [searched, filter]);

  // One pass for all five chip counts, instead of five filters over the list.
  const filterCounts = useMemo(() => {
    const n = { all: searched.length, todo: 0, done: 0, bookmarked: 0, revisit: 0 };
    for (const t of searched) {
      if (t.done) n.done++;
      else n.todo++;
      if (t.bookmarked) n.bookmarked++;
      if (t.revisit) n.revisit++;
    }
    return n;
  }, [searched]);

  // Drives the top celebration tier: ticking the last undone question in the
  // whole area is the rarest moment in the app.
  const undoneTotal = useMemo(() => tasks.filter((t) => !t.done).length, [tasks]);

  /*
   * Undone counts per section and per heading, computed in ONE pass over the
   * task list and looked up by key afterwards.
   *
   * These feed the celebration tier, so every rendered row needs both. Deriving
   * them per row meant scanning all 456 tasks 456 times — 208k iterations on
   * every keystroke, which measured at 1-2s per filter cycle. One pass and two
   * map lookups is the same answer for a fraction of the work.
   */
  const undoneCounts = useMemo(() => {
    const bySection = new Map<string, number>();
    const byHeading = new Map<string, number>();
    for (const t of tasks) {
      if (t.done) continue;
      const heading = t.heading || '—';
      for (const id of t.topicIds) {
        bySection.set(id, (bySection.get(id) ?? 0) + 1);
        const key = `${id}\u0000${heading}`;
        byHeading.set(key, (byHeading.get(key) ?? 0) + 1);
      }
    }
    return { bySection, byHeading };
  }, [tasks]);

  /*
   * Per-section done/total, from ONE pass over the task list.
   *
   * These come from every task in the section, never the filtered slice, so
   * the numbers on a collapsed section do not change when you search. Derived
   * separately from `sections` because they depend only on `tasks` — rebuilding
   * them per keystroke was 18 x 456 wasted comparisons.
   */
  const sectionTotals = useMemo(() => {
    const m = new Map<string, { done: number; total: number }>();
    for (const t of tasks) {
      for (const id of t.topicIds) {
        const row = m.get(id) ?? { done: 0, total: 0 };
        row.total++;
        if (t.done) row.done++;
        m.set(id, row);
      }
    }
    return m;
  }, [tasks]);

  // Per-section groups, in sheet order. Sections with nothing left after
  // filtering drop out entirely rather than showing an empty shell.
  // Bucketed in one pass rather than filtering the whole list once per topic,
  // which was 18 x 456 comparisons on every keystroke.
  const sections = useMemo(() => {
    const byTopic = new Map<string, Task[]>();
    for (const t of visible) {
      for (const id of t.topicIds) {
        const list = byTopic.get(id);
        if (list) list.push(t);
        else byTopic.set(id, [t]);
      }
    }
    const out: { topic: Topic; rows: Task[]; done: number; total: number }[] = [];
    for (const topic of topics) {
      const rows = byTopic.get(topic.id);
      if (!rows?.length) continue;
      const totals = sectionTotals.get(topic.id) ?? { done: 0, total: 0 };
      out.push({ topic, rows, done: totals.done, total: totals.total });
    }
    return out;
  }, [topics, visible, sectionTotals]);

  // The flat keyboard order: exactly what is on screen, top to bottom.
  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  const searching = deferredQuery.trim().length > 0;

  // Clamped during render rather than corrected in an effect: filtering can
  // shrink the list under the cursor, and fixing that with setState in an
  // effect would cascade an extra render on every keystroke.
  const active = cursor < 0 ? -1 : Math.min(cursor, flat.length - 1);
  const activeTask = active >= 0 ? flat[active] : undefined;

  /*
   * Everything starts collapsed.
   *
   * 18 sections holding 456 questions is far too much to open into. Collapsed,
   * the whole area fits on about one screen and you choose what to open;
   * expanded, finding anything means scrolling past hundreds of rows you did
   * not ask for.
   *
   * `expanded` rather than `collapsed` so the default state is the empty set
   * and no section list has to be enumerated up front.
   */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Searching overrides the collapse state: hiding a hit inside a collapsed
  // section makes search look broken.
  const isOpen = useCallback(
    (id: string) => searching || expanded.has(id),
    [searching, expanded],
  );

  const toggleSection = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /*
   * Where to pick up: the first section that is started but unfinished, or
   * failing that the first with nothing done. Collapsing everything only works
   * if the page still says where you were.
   */
  const resumeId = useMemo(() => {
    let firstUntouched: string | undefined;
    for (const { topic, done, total } of sections) {
      if (done > 0 && done < total) return topic.id;
      if (done === 0 && firstUntouched === undefined) firstUntouched = topic.id;
    }
    return firstUntouched;
  }, [sections]);

  const allExpanded = sections.length > 0 && sections.every((s) => expanded.has(s.topic.id));

  // ---- keyboard ---------------------------------------------------------
  // One listener for the whole sheet, not one per row.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = isTypingTarget(e.target);
      const action = mapSheetKey(e, typing);
      if (!action) return;

      if (action === 'dismiss') {
        if (help) { setHelp(false); e.preventDefault(); return; }
        if (typing) {
          // Escape in the search box clears it, then releases focus.
          if (query) { setQuery(''); e.preventDefault(); }
          else (e.target as HTMLElement).blur();
          return;
        }
        if (active >= 0) { setCursor(-1); e.preventDefault(); }
        return;
      }

      if (action === 'focusSearch') {
        e.preventDefault();
        searchBox.current?.focus();
        searchBox.current?.select();
        return;
      }
      if (action === 'help') { e.preventDefault(); setHelp((v) => !v); return; }

      if (action === 'next' || action === 'prev') {
        if (!flat.length) return;
        e.preventDefault();
        setCursor((c) => {
          const from = c < 0 ? -1 : Math.min(c, flat.length - 1);
          const next = action === 'next' ? from + 1 : from - 1;
          return Math.max(0, Math.min(next, flat.length - 1));
        });
        return;
      }

      // The remaining actions all operate on the focused row. Reusing the
      // row's own controls means the optimistic update, the celebration and
      // the undo offer all happen exactly as they do for a click, with no
      // duplicated logic.
      if (!activeTask) return;
      const el = root.current?.querySelector<HTMLElement>(`[data-row-id="${cssEscape(activeTask.id)}"]`);
      if (!el) return;
      const target =
        action === 'toggle'
          ? el.querySelector<HTMLElement>('input[type="checkbox"]')
          : el.querySelector<HTMLElement>(
              action === 'bookmark' ? '[data-flag="bookmarked"]' : '[data-flag="revisit"]',
            );
      if (!target) return;
      e.preventDefault();
      target.click();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flat, active, activeTask, help, query]);

  // Move real focus to the cursor row so screen readers follow and Space
  // toggles natively, then put the row somewhere it can actually be seen.
  //
  // scrollIntoView({block:'nearest'}) is not enough on its own: it does nothing
  // when the row is already inside the viewport, and "inside the viewport"
  // includes the strip covered by the sticky search bar and heading band. A row
  // walked to with `k` therefore sat underneath them — measured at 90px hidden
  // — and scroll-margin never applied, because no scroll ever happened. So the
  // occluded case is handled explicitly, and the offset is read from the same
  // custom property the sticky elements use rather than repeated here.
  useEffect(() => {
    if (!activeTask) return;
    const el = root.current?.querySelector<HTMLElement>(
      `[data-row-id="${cssEscape(activeTask.id)}"] input[type="checkbox"]`,
    );
    el?.focus({ preventScroll: true });
    const row = el?.closest('li');
    if (!row) return;

    const chrome = stickyChrome(root.current);
    const box = row.getBoundingClientRect();
    if (box.top < chrome) {
      // Behind the sticky chrome: nothing else will move it.
      window.scrollBy({ top: box.top - chrome, behavior: 'auto' });
    } else if (box.bottom > window.innerHeight) {
      row.scrollIntoView({ block: 'nearest' });
    }
  }, [activeTask]);

  // ---- command palette entries -----------------------------------------
  // The sheet is the only place that knows the sections, so it publishes them
  // while mounted and withdraws them on unmount.
  useEffect(() => {
    return publishCommands([
      ...sectionCommands(topics, (id) => {
        setQuery('');
        setExpanded(new Set([id]));
        requestAnimationFrame(() => {
          document
            .querySelector(`[data-section-id="${cssEscape(id)}"]`)
            ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
      }),
      {
        id: 'sheet:search',
        label: 'Search questions',
        group: 'Sheet',
        run: () => searchBox.current?.focus(),
      },
      {
        id: 'sheet:shortcuts',
        label: 'Keyboard shortcuts',
        group: 'Sheet',
        run: () => setHelp(true),
      },
      ...(['all', 'todo', 'done', 'bookmarked', 'revisit'] as const).map((f) => ({
        id: `sheet:filter:${f}`,
        label: `Filter: ${FILTER_LABEL[f]}`,
        group: 'Sheet',
        run: () => setFilter(f),
      })),
    ]);
  }, [topics]);

  const compact = density === 'compact';

  return (
    <div
      ref={root}
      className="space-y-3"
      // Declared on the root because custom properties inherit downwards and
      // the bands and rows are siblings of the bar, not its children.
      style={{ ['--sheet-chrome' as string]: '146px' }}
    >
      {/* Search and filters stay put while the list scrolls — on a page this
          long, having to scroll back to the top to search is the whole
          problem. `top-14` clears the sticky nav bar.

          --sheet-chrome is how far down the page is covered by sticky chrome:
          the 56px nav plus this bar. Heading bands stick below it and keyboard
          navigation scrolls rows clear of it, so the three cannot drift apart.
          Measured at 146px; the bar is 90px tall. */}
      <div className="sticky top-14 z-20 -mx-3 space-y-2 border-b border-hairline bg-plane/90 px-3 pt-2 pb-2 backdrop-blur-md sm:-mx-4 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-muted" />
          <input
            ref={searchBox}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${tasks.length} questions…`}
            aria-label={`Search ${areaName} questions`}
            className={cn(
              'skin-pill w-full border border-hairline bg-surface py-1.5 pr-8 pl-8 text-sm',
              'outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
              '[&::-webkit-search-cancel-button]:hidden',
            )}
          />
          {query ? (
            <button
              type="button"
              onClick={() => { setQuery(''); searchBox.current?.focus(); }}
              aria-label="Clear search"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setDensity(compact ? 'comfortable' : 'compact')}
          aria-label={compact ? 'Comfortable rows' : 'Compact rows'}
          title={compact ? 'Comfortable rows' : 'Compact rows'}
          className="skin-pill shrink-0 border border-hairline p-2 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          {compact ? <Rows3 className="size-3.5" /> : <Rows4 className="size-3.5" />}
        </button>

        <button
          type="button"
          onClick={() => setHelp(true)}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
          className="skin-pill hidden shrink-0 border border-hairline p-2 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent sm:block"
        >
          <Keyboard className="size-3.5" />
        </button>
      </div>

      {/* ---- filter chips: instant, no navigation ---- */}
      <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5">
        {(['all', 'todo', 'done', 'bookmarked', 'revisit'] as const).map((key) => {
          // Counts reflect the current search, so the chips describe what
          // switching to them would actually show.
          const count = filterCounts[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={cn(
                'skin-pill shrink-0 border px-3 py-1 text-xs font-medium transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                filter === key
                  ? 'border-transparent bg-accent text-accent-ink'
                  : 'border-hairline text-ink-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              {FILTER_LABEL[key]}
              <span className="ml-1 opacity-70 tnum">{count}</span>
            </button>
          );
        })}

        {/* Opening all 18 at once is occasionally what you want; it is never
            what you want by default. */}
        {!searching && sections.length > 1 ? (
          <button
            type="button"
            onClick={() =>
              setExpanded(allExpanded ? new Set() : new Set(sections.map((x) => x.topic.id)))
            }
            className="skin-pill ml-auto shrink-0 border border-hairline px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        ) : null}
      </div>
      </div>

      {/* ---- results ----
          The live region is always mounted, and only its text changes. A region
          inserted at the same moment as its content is not reliably announced —
          screen readers watch regions that were already there, so the first
          search result was the one most likely to be missed. */}
      <p className="px-1 text-xs text-ink-muted empty:hidden" role="status" aria-live="polite">
        {searching
          ? visible.length === 0
            ? 'No matches'
            : `${visible.length} match${visible.length === 1 ? '' : 'es'} across ${sections.length} section${sections.length === 1 ? '' : 's'}`
          : ''}
      </p>

      {sections.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <CharacterFigure pose="idle" size={68} />
            <div>
              <p className="text-sm font-medium text-ink">Nothing matches</p>
              <p className="mt-0.5 text-xs text-ink-muted">
                {searching
                  ? 'Try fewer words, or a section name.'
                  : 'Nothing here with this filter.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setQuery(''); setFilter('all'); }}
              className="skin-pill border border-hairline px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            >
              Clear search and filters
            </button>
          </div>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {sections.map(({ topic, rows, done, total }) => (
            <Card key={topic.id} className="js-lift overflow-hidden" data-section-id={topic.id}>
              <button
                type="button"
                onClick={() => toggleSection(topic.id)}
                aria-expanded={isOpen(topic.id)}
                className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:px-5"
              >
                <Chevron open={isOpen(topic.id)} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-sm font-medium">{topic.name}</span>
                      {/* The one section worth opening first, named rather than
                          left for you to hunt for. */}
                      {!searching && topic.id === resumeId ? (
                        <span className="skin-pill shrink-0 bg-accent px-1.5 py-0.5 text-micro font-semibold text-accent-ink">
                          Continue
                        </span>
                      ) : null}
                      {done === total && total > 0 ? (
                        <Check className="size-3 shrink-0 text-good" aria-label="Section complete" />
                      ) : null}
                    </span>
                    <span className="shrink-0 text-xs text-ink-muted tnum">
                      {searching ? `${rows.length} of ${total}` : `${done}/${total}`}
                    </span>
                  </span>
                  <span className="mt-1.5 block">
                    <ProgressBar
                      value={total ? (done / total) * 100 : 0}
                      height={4}
                      color={
                        total && done === total
                          ? 'var(--good)'
                          : done > 0
                            ? 'var(--accent)'
                            : 'var(--axis)'
                      }
                      label={`${topic.name} progress`}
                    />
                  </span>
                </span>
              </button>

              {isOpen(topic.id) ? (
                <div className="border-t border-hairline">
                  {groupByHeading(rows).map((h) => (
                    <section key={h.heading}>
                      {/* Heading rows are categories, not questions — they are
                          never counted toward any total. */}
                      <HeadingBand label={h.heading} count={`${h.done}/${h.total}`} sticky />
                      <ul>
                        {h.items.map((t) => (
                          <TaskRow
                            key={t.id}
                            task={t}
                            index={t.order + 1}
                            compact={compact}
                            focused={activeTask?.id === t.id}
                            // Counted against the WHOLE list, never the filtered
                            // slice — otherwise hiding done rows would make
                            // every tick look like it finished something.
                            remainingHeading={
                              undoneCounts.byHeading.get(`${topic.id}\u0000${h.heading}`) ?? 0
                            }
                            remainingSection={undoneCounts.bySection.get(topic.id) ?? 0}
                            remainingArea={undoneTotal}
                          />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      <p className="px-1 pb-1 text-center text-micro text-ink-muted">
        {pct(tasks.filter((t) => t.done).length, tasks.length)}% of {areaName} complete
        <span className="hidden [@media(hover:hover)]:inline">
          {' · press '}
          <kbd className="rounded border border-hairline bg-surface-2 px-1">?</kbd> for shortcuts
        </span>
      </p>

      <ShortcutsOverlay open={help} onClose={() => setHelp(false)} />
    </div>
  );
}

const FILTER_LABEL: Record<Filter, string> = {
  all: 'All',
  todo: 'To do',
  done: 'Done',
  bookmarked: 'Saved',
  revisit: 'Revisit',
};

function sectionCommands(topics: Topic[], go: (id: string) => void) {
  return topics.map((t) => ({
    id: `section:${t.id}`,
    label: t.name,
    group: 'Jump to section',
    run: () => go(t.id),
  }));
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn('size-4 shrink-0 text-ink-muted transition-transform', open && 'rotate-90')}
      aria-hidden
    >
      <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * How much of the top of the page is covered by sticky chrome: the nav plus the
 * sheet's search bar, plus a heading band's height. Read from the same custom
 * property the sticky elements position against, so there is one number.
 */
const BAND_HEIGHT = 36;
function stickyChrome(el: HTMLElement | null): number {
  if (!el) return 56 + BAND_HEIGHT;
  const raw = getComputedStyle(el).getPropertyValue('--sheet-chrome').trim();
  const px = Number.parseFloat(raw);
  return (Number.isFinite(px) ? px : 56) + BAND_HEIGHT;
}

/**
 * CSS.escape with a fallback — Notion page ids are uuids, but they arrive from
 * the API and a selector built from an unescaped one would throw.
 */
function cssEscape(v: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(v);
  return v.replace(/["\\]/g, '\\$&');
}
