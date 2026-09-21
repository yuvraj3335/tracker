'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Search, X, Rows3, Rows4, Keyboard } from 'lucide-react';
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
  initialOpen,
}: {
  topics: Topic[];
  tasks: Task[];
  areaName: string;
  initialFilter?: string;
  initialOpen?: string;
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
  const visible = useMemo(() => {
    const searched = searchIndexed(index, deferredQuery);
    return applyFilter(searched, filter);
  }, [index, deferredQuery, filter]);

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

  // Per-section groups, in sheet order. Sections with nothing left after
  // filtering drop out entirely rather than showing an empty shell.
  const sections = useMemo(() => {
    const out: { topic: Topic; rows: Task[]; done: number; total: number }[] = [];
    for (const topic of topics) {
      const rows = visible.filter((t) => t.topicIds.includes(topic.id));
      if (!rows.length) continue;
      const all = tasks.filter((t) => t.topicIds.includes(topic.id));
      out.push({ topic, rows, done: all.filter((t) => t.done).length, total: all.length });
    }
    return out;
  }, [topics, visible, tasks]);

  // The flat keyboard order: exactly what is on screen, top to bottom.
  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  const searching = deferredQuery.trim().length > 0;

  // Clamped during render rather than corrected in an effect: filtering can
  // shrink the list under the cursor, and fixing that with setState in an
  // effect would cascade an extra render on every keystroke.
  const active = cursor < 0 ? -1 : Math.min(cursor, flat.length - 1);
  const activeTask = active >= 0 ? flat[active] : undefined;

  // Which sections are expanded. While searching every match is shown, because
  // hiding a hit inside a collapsed section makes search look broken.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const start = new Set<string>();
    for (const t of topics) if (initialOpen && t.id !== initialOpen) start.add(t.id);
    return start;
  });
  const isOpen = useCallback(
    (id: string) => searching || !collapsed.has(id),
    [searching, collapsed],
  );

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

  // Move real focus to the cursor row so screen readers follow, Space toggles
  // natively, and the browser scrolls it into view.
  useEffect(() => {
    if (!activeTask) return;
    const el = root.current?.querySelector<HTMLElement>(
      `[data-row-id="${cssEscape(activeTask.id)}"] input[type="checkbox"]`,
    );
    el?.focus({ preventScroll: true });
    el?.closest('li')?.scrollIntoView({ block: 'nearest' });
  }, [activeTask]);

  // ---- command palette entries -----------------------------------------
  // The sheet is the only place that knows the sections, so it publishes them
  // while mounted and withdraws them on unmount.
  useEffect(() => {
    return publishCommands([
      ...sectionCommands(topics, (id) => {
        setQuery('');
        setCollapsed(new Set(topics.filter((t) => t.id !== id).map((t) => t.id)));
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
    <div ref={root} className="space-y-3">
      {/* ---- search + controls ---- */}
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
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
        {(['all', 'todo', 'done', 'bookmarked', 'revisit'] as const).map((key) => {
          // Counts reflect the current search, so the chips describe what
          // switching to them would actually show.
          const base = searchIndexed(index, deferredQuery);
          const count = applyFilter(base, key).length;
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
      </div>

      {/* ---- results ---- */}
      {searching ? (
        <p className="px-1 text-xs text-ink-muted" role="status" aria-live="polite">
          {visible.length === 0
            ? 'No matches'
            : `${visible.length} match${visible.length === 1 ? '' : 'es'} across ${sections.length} section${sections.length === 1 ? '' : 's'}`}
        </p>
      ) : null}

      {sections.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <CharacterFigure pose="idle" size={56} />
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
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(topic.id)) next.delete(topic.id);
                    else next.add(topic.id);
                    return next;
                  })
                }
                aria-expanded={isOpen(topic.id)}
                className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:px-5"
              >
                <Chevron open={isOpen(topic.id)} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">{topic.name}</span>
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
        {pct(
          tasks.filter((t) => t.done).length,
          tasks.length,
        )}
        % of {areaName} done · press{' '}
        <kbd className="rounded border border-hairline bg-surface-2 px-1">?</kbd> for shortcuts
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
 * CSS.escape with a fallback — Notion page ids are uuids, but they arrive from
 * the API and a selector built from an unescaped one would throw.
 */
function cssEscape(v: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(v);
  return v.replace(/["\\]/g, '\\$&');
}
