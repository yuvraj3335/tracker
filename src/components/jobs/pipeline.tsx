'use client';

import { useCallback, useDeferredValue, useMemo, useOptimistic, useState, useSyncExternalStore, useTransition } from 'react';
import { Columns3, List, Search, X } from 'lucide-react';
import { setJobStatusAction } from '@/app/jobs/actions';
import { JOB_GROUPS, jobHaystack, type Job } from '@/lib/jobs';
import { JOB_SOURCES, type JobStatus } from '@/lib/schema';
import { matchesTokens, tokenize } from '@/lib/search';
import { offerUndo, reportProblem } from '@/lib/undo';
import type { DayKey } from '@/lib/date';
import { Card } from '../ui/card';
import { HeadingBand } from '../heading-band';
import { JobRow, JobTile } from './job-card';
import { Dot, GROUP_COLOR } from './job-ui';
import { cn } from '@/lib/utils';

type Sort = 'newest' | 'match' | 'updated';
const SORT_LABEL: Record<Sort, string> = { newest: 'Newest', match: 'Best fit', updated: 'Recently updated' };
type View = 'board' | 'list';
export type Stage = 'open' | 'all' | (typeof JOB_GROUPS)[number]['id'];

const OPEN_GROUPS = JOB_GROUPS.filter((g) => g.id !== 'closed');

/** Where a job lands when it is dropped on a column. */
const DROP_STATUS: Record<string, JobStatus> = {
  review: 'Found',
  apply: 'Shortlisted',
  applied: 'Applied',
  process: 'Interviewing',
  offer: 'Offer',
};

// ---------------------------------------------------------------------------
// The view choice is per device, like the skin and the density: a phone has no
// room for five columns, and a laptop user who prefers the list should keep it.
// ---------------------------------------------------------------------------
const VIEW_KEY = 'jst-jobs-view';
const viewListeners = new Set<() => void>();
function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'board';
  } catch {
    return 'board';
  }
}
function writeView(v: View) {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* private window: the choice lasts for this page */
  }
  viewListeners.forEach((l) => l());
}
function subscribeView(l: () => void) {
  viewListeners.add(l);
  return () => {
    viewListeners.delete(l);
  };
}

/**
 * The pipeline: a board on a laptop, a list on a phone, both over the same
 * rows already loaded — filtering, search and sorting never go back to
 * Notion. Moves are optimistic and offer an undo, like ticking a question.
 */
export function Pipeline({ jobs, today, initialStage = 'open' }: { jobs: Job[]; today: DayKey; initialStage?: Stage }) {
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<Stage>(initialStage);
  const [source, setSource] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const view = useSyncExternalStore(subscribeView, readView, () => 'board' as View);
  const deferred = useDeferredValue(query);

  const [, startTransition] = useTransition();
  const [shown, applyMove] = useOptimistic(jobs, (state: Job[], m: { id: string; status: JobStatus }) =>
    state.map((j) => (j.id === m.id ? { ...j, status: m.status } : j)),
  );

  const move = useCallback(
    (job: Job, next: JobStatus) => {
      if (job.status === next) return;
      const before = job.status;
      startTransition(async () => {
        applyMove({ id: job.id, status: next });
        const r = await setJobStatusAction(job.id, next);
        if (!r?.ok) {
          reportProblem(r?.message ?? `Could not move “${job.role}”.`);
          return;
        }
        offerUndo(`Moved “${job.role}” to ${next}`, async () => {
          await setJobStatusAction(job.id, before);
        });
      });
    },
    [applyMove],
  );

  const indexed = useMemo(() => shown.map((j) => ({ job: j, hay: jobHaystack(j) })), [shown]);
  const visible = useMemo(() => {
    const tokens = tokenize(deferred);
    const rows = indexed.filter(({ job, hay }) => (!source || job.source === source) && matchesTokens(hay, tokens)).map(({ job }) => job);
    const by: Record<Sort, (a: Job, b: Job) => number> = {
      newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
      match: (a, b) => (b.match ?? -1) - (a.match ?? -1) || b.createdAt.localeCompare(a.createdAt),
      updated: (a, b) => (b.lastUpdate ?? '').localeCompare(a.lastUpdate ?? '') || b.createdAt.localeCompare(a.createdAt),
    };
    return rows.sort(by[sort]);
  }, [indexed, deferred, source, sort]);

  const grouped = useMemo(
    () => Object.fromEntries(JOB_GROUPS.map((g) => [g.id, visible.filter((j) => g.statuses.includes(j.status))])) as Record<string, Job[]>,
    [visible],
  );
  const counts: Record<string, number> = {
    ...Object.fromEntries(JOB_GROUPS.map((g) => [g.id, grouped[g.id].length])),
    open: OPEN_GROUPS.reduce((n, g) => n + grouped[g.id].length, 0),
    all: visible.length,
  };

  const sources = useMemo(() => JOB_SOURCES.filter((s) => jobs.some((j) => j.source === s)), [jobs]);
  const searching = deferred.trim().length > 0 || Boolean(source);
  const chips: { id: Stage; label: string }[] = [{ id: 'open', label: 'Open' }, ...JOB_GROUPS.map((g) => ({ id: g.id as Stage, label: g.label })), { id: 'all', label: 'All' }];

  const listGroups = JOB_GROUPS.filter((g) => (stage === 'all' ? true : stage === 'open' ? g.id !== 'closed' : g.id === stage)).filter((g) => grouped[g.id].length);
  const boardGroups = OPEN_GROUPS.filter((g) => stage === 'open' || stage === 'all' || g.id === stage);
  // The board only makes sense for open stages; asking for Closed shows it as a list.
  const boardable = stage !== 'closed';

  return (
    <div className="space-y-3">
      {/* ---- toolbar ---- */}
      <div className="sticky top-14 z-20 -mx-3 space-y-2 border-b border-hairline bg-plane/90 px-3 pt-2 pb-2 backdrop-blur-md sm:-mx-4 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-full sm:basis-0">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${jobs.length} jobs — company, role, city, skill…`}
              aria-label="Search jobs"
              className="skin-pill w-full border border-hairline bg-surface py-1.5 pr-8 pl-8 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
          <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Filter by source" className="skin-pill shrink-0 cursor-pointer border border-hairline bg-surface px-2.5 py-1.5 text-xs text-ink-2 outline-none focus-visible:outline-2 focus-visible:outline-accent">
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort jobs" className="skin-pill shrink-0 cursor-pointer border border-hairline bg-surface px-2.5 py-1.5 text-xs text-ink-2 outline-none focus-visible:outline-2 focus-visible:outline-accent">
            {(Object.keys(SORT_LABEL) as Sort[]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
          {/* Board or list — on a laptop. A phone always gets the list. */}
          <div className="skin-pill hidden shrink-0 items-center gap-0.5 border border-hairline bg-surface p-0.5 lg:inline-flex" role="group" aria-label="View">
            {(['board', 'list'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => writeView(v)}
                aria-pressed={view === v}
                className={cn(
                  'skin-pill inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent',
                  view === v ? 'bg-surface-2 text-ink' : 'text-ink-muted hover:text-ink',
                )}
              >
                {v === 'board' ? <Columns3 className="size-3.5" /> : <List className="size-3.5" />}
                {v === 'board' ? 'Board' : 'List'}
              </button>
            ))}
          </div>
        </div>
        <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setStage(c.id)}
              aria-pressed={stage === c.id}
              className={cn(
                'skin-pill inline-flex shrink-0 items-center gap-1.5 border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                stage === c.id ? 'border-transparent bg-accent text-accent-ink' : 'border-hairline text-ink-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              {GROUP_COLOR[c.id] && stage !== c.id ? <Dot color={GROUP_COLOR[c.id]} /> : null}
              {c.label}
              <span className="opacity-70 tnum">{counts[c.id] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="px-1 text-xs text-ink-muted empty:hidden" role="status" aria-live="polite">
        {searching ? `${visible.length} match${visible.length === 1 ? '' : 'es'}` : ''}
      </p>

      {/* ---- board (laptop) ---- */}
      {view === 'board' && boardable ? (
        <div className="hidden space-y-3 lg:block">
          <Board groups={boardGroups} grouped={grouped} today={today} onMove={move} />
          {stage !== 'open' || !grouped.closed.length ? null : (
            <details className="group skin-card border border-hairline bg-surface">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-ink-2 hover:bg-surface-2/50 [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2">
                  <Dot color={GROUP_COLOR.closed} />
                  Closed — rejected, ghosted, withdrawn or skipped
                </span>
                <span className="text-xs text-ink-muted tnum">{grouped.closed.length}</span>
              </summary>
              <ul className="border-t border-hairline">
                {grouped.closed.map((j) => (
                  <JobRow key={j.id} job={j} today={today} pending={false} onMove={move} />
                ))}
              </ul>
            </details>
          )}
        </div>
      ) : null}

      {/* ---- list (phone always; laptop when chosen) ---- */}
      <div className={cn(view === 'board' && boardable && 'lg:hidden')}>
        {listGroups.length === 0 ? (
          <Card>
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-medium text-ink">Nothing here</p>
              <p className="mt-0.5 text-xs text-ink-muted">{searching ? 'Try a different search or source.' : 'No jobs in this stage yet.'}</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-2.5">
            {listGroups.map((g) => (
              <Card key={g.id} className="overflow-hidden">
                <HeadingBand label={g.hint ? `${g.label} · ${g.hint}` : g.label} count={String(grouped[g.id].length)} className="border-t-0" />
                <ul>
                  {grouped[g.id].map((j) => (
                    <JobRow key={j.id} job={j} today={today} pending={false} onMove={move} />
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Five columns, one per open stage. Dragging a card onto a column moves the
 * job there; the keyboard path is the status control on the job's page and in
 * the list, so nothing depends on a mouse.
 */
function Board({
  groups,
  grouped,
  today,
  onMove,
}: {
  groups: readonly (typeof JOB_GROUPS)[number][];
  grouped: Record<string, Job[]>;
  today: DayKey;
  onMove: (job: Job, next: JobStatus) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const all = useMemo(() => Object.values(grouped).flat(), [grouped]);

  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))` }}>
      {groups.map((g) => {
        const rows = grouped[g.id];
        const target = DROP_STATUS[g.id];
        return (
          <section
            key={g.id}
            aria-label={`${g.label}, ${rows.length} job${rows.length === 1 ? '' : 's'}`}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (over !== g.id) setOver(g.id);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/x-job-id') || dragId;
              const job = all.find((j) => j.id === id);
              setOver(null);
              setDragId(null);
              // Dropping back into its own stage is not a move — an Assessment
              // dropped on "In process" stays an Assessment.
              if (job && !g.statuses.includes(job.status)) onMove(job, target);
            }}
            className={cn(
              'flex min-w-0 flex-col rounded-[min(var(--radius-card),14px)] border border-transparent bg-surface-2/60 p-2 transition-colors',
              over === g.id && 'border-accent/60 bg-surface-2',
            )}
          >
            <header className="flex items-center justify-between gap-2 px-1.5 pt-0.5 pb-2">
              <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-ink">
                <Dot color={GROUP_COLOR[g.id]} />
                <span className="truncate">{g.label}</span>
              </span>
              <span className="text-micro text-ink-muted tnum">{rows.length}</span>
            </header>
            {rows.length ? (
              <ul className="space-y-2">
                {rows.map((j) => (
                  <JobTile key={j.id} job={j} today={today} dragging={dragId === j.id} onDragStart={setDragId} onDragEnd={() => { setDragId(null); setOver(null); }} />
                ))}
              </ul>
            ) : (
              <p className={cn('rounded-lg border border-dashed px-2 py-6 text-center text-micro', over === g.id ? 'border-accent/60 text-ink-2' : 'border-hairline text-ink-muted')}>
                {over === g.id ? `Drop to move to ${target}` : g.hint || 'Nothing here'}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
