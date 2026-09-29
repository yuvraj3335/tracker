'use client';

import { memo, useDeferredValue, useMemo, useOptimistic, useState, useTransition } from 'react';
import Link from 'next/link';
import { ExternalLink, Search, X } from 'lucide-react';
import { setJobStatusAction } from '@/app/jobs/actions';
import { JOB_GROUPS, followUpFor, jobHaystack, type Job } from '@/lib/jobs';
import { JOB_SOURCES, JOB_STATUS, type JobStatus } from '@/lib/schema';
import { matchesTokens, tokenize } from '@/lib/search';
import { offerUndo, reportProblem } from '@/lib/undo';
import type { DayKey } from '@/lib/date';
import { Card } from '../ui/card';
import { HeadingBand } from '../heading-band';
import { FollowUpBadge, MatchBadge, StatusDot, ago, safeHref } from './job-ui';
import { cn } from '@/lib/utils';

type Sort = 'newest' | 'match' | 'updated';
const SORT_LABEL: Record<Sort, string> = { newest: 'Newest', match: 'Best match', updated: 'Recently updated' };

/** "Open" is every group but Closed: what a person is still working on. */
type View = 'open' | (typeof JOB_GROUPS)[number]['id'] | 'all';

/**
 * The pipeline.
 *
 * Grouped by stage rather than drawn as a kanban: ten columns do not fit a
 * phone, and six groups stacked in pipeline order read the same way on both.
 * Filtering, search and sorting are all local over rows already loaded — the
 * list is tens of jobs, not thousands.
 */
export function JobsBoard({ jobs, today }: { jobs: Job[]; today: DayKey }) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('open');
  const [source, setSource] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const deferred = useDeferredValue(query);

  const indexed = useMemo(() => jobs.map((j) => ({ job: j, hay: jobHaystack(j) })), [jobs]);

  const visible = useMemo(() => {
    const tokens = tokenize(deferred);
    const rows = indexed
      .filter(({ job, hay }) => (!source || job.source === source) && matchesTokens(hay, tokens))
      .map(({ job }) => job);
    const by: Record<Sort, (a: Job, b: Job) => number> = {
      newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
      match: (a, b) => (b.match ?? -1) - (a.match ?? -1) || b.createdAt.localeCompare(a.createdAt),
      updated: (a, b) => (b.lastUpdate ?? '').localeCompare(a.lastUpdate ?? '') || b.createdAt.localeCompare(a.createdAt),
    };
    return rows.sort(by[sort]);
  }, [indexed, deferred, source, sort]);

  const counts = useMemo(() => {
    const n: Record<string, number> = { all: visible.length, open: 0 };
    for (const g of JOB_GROUPS) n[g.id] = 0;
    for (const j of visible) {
      const g = JOB_GROUPS.find((x) => x.statuses.includes(j.status));
      if (!g) continue;
      n[g.id]++;
      if (g.id !== 'closed') n.open++;
    }
    return n;
  }, [visible]);

  const groups = JOB_GROUPS.filter((g) =>
    view === 'all' ? true : view === 'open' ? g.id !== 'closed' : g.id === view,
  )
    .map((g) => ({ ...g, rows: visible.filter((j) => g.statuses.includes(j.status)) }))
    .filter((g) => g.rows.length);

  const sources = useMemo(() => JOB_SOURCES.filter((s) => jobs.some((j) => j.source === s)), [jobs]);
  const searching = deferred.trim().length > 0;

  const chips: { id: View; label: string }[] = [
    { id: 'open', label: 'Open' },
    ...JOB_GROUPS.map((g) => ({ id: g.id as View, label: g.label })),
    { id: 'all', label: 'All' },
  ];

  return (
    <div className="space-y-3">
      <div className="sticky top-14 z-20 -mx-3 space-y-2 border-b border-hairline bg-plane/90 px-3 pt-2 pb-2 backdrop-blur-md sm:-mx-4 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* Full width on a phone, with the two selects on the row below;
              side by side once there is room. */}
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
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            aria-label="Filter by source"
            className="skin-pill shrink-0 cursor-pointer border border-hairline bg-surface px-2.5 py-1.5 text-xs text-ink-2 outline-none focus-visible:outline-2 focus-visible:outline-accent"
          >
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="Sort jobs"
            className="skin-pill shrink-0 cursor-pointer border border-hairline bg-surface px-2.5 py-1.5 text-xs text-ink-2 outline-none focus-visible:outline-2 focus-visible:outline-accent"
          >
            {(Object.keys(SORT_LABEL) as Sort[]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setView(c.id)}
              aria-pressed={view === c.id}
              className={cn(
                'skin-pill shrink-0 border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                view === c.id
                  ? 'border-transparent bg-accent text-accent-ink'
                  : 'border-hairline text-ink-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              {c.label}
              <span className="ml-1 opacity-70 tnum">{counts[c.id] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="px-1 text-xs text-ink-muted empty:hidden" role="status" aria-live="polite">
        {searching ? `${visible.length} match${visible.length === 1 ? '' : 'es'}` : ''}
      </p>

      {groups.length === 0 ? (
        <Card>
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium text-ink">Nothing here</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              {searching || source ? 'Try a different search or source.' : 'No jobs in this stage yet.'}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {groups.map((g) => (
            <Card key={g.id} className="overflow-hidden">
              <HeadingBand label={g.hint ? `${g.label} · ${g.hint}` : g.label} count={String(g.rows.length)} className="border-t-0" />
              <ul>
                {g.rows.map((j) => (
                  <JobRow key={j.id} job={j} today={today} />
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

const JobRow = memo(function JobRow({ job, today }: { job: Job; today: DayKey }) {
  const [pending, start] = useTransition();
  const [status, setStatus] = useOptimistic(job.status);
  const followUp = followUpFor({ ...job, status }, today);
  const href = safeHref(job.applyUrl) ?? safeHref(job.jobUrl);
  const meta = [job.location, job.workMode, job.source].filter(Boolean).join(' · ');

  function move(next: JobStatus) {
    if (next === status) return;
    const before = status;
    start(async () => {
      setStatus(next);
      const r = await setJobStatusAction(job.id, next);
      if (!r?.ok) reportProblem(r?.message ?? `Could not move “${job.role}”.`);
      else offerUndo(`Moved “${job.role}” to ${next}`, async () => void (await setJobStatusAction(job.id, before)));
    });
  }

  return (
    <li className={cn('flex items-start gap-3 border-b border-hairline px-3 py-2.5 last:border-0 sm:px-4', pending && 'opacity-60')}>
      <StatusDot status={status} className="mt-1.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Link href={`/jobs/${job.id}`} className="text-sm font-medium text-ink hover:text-accent hover:underline underline-offset-2">
            {job.role}
          </Link>
          <span className="text-sm text-ink-2">{job.company}</span>
          <MatchBadge match={job.match} />
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-ink-muted">
          {meta ? <span>{meta}</span> : null}
          <span className="tnum">
            {job.appliedOn ? `applied ${ago(job.appliedOn, today)}` : job.postedOn ? `posted ${ago(job.postedOn, today)}` : job.foundOn ? `added ${ago(job.foundOn, today)}` : ''}
          </span>
          {job.nextStep ? <span className="text-ink-2">→ {job.nextStep}</span> : null}
          <FollowUpBadge followUp={followUp} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Open the ${job.role} posting`}
            className="rounded-md p-2 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
        <select
          value={status}
          onChange={(e) => move(e.target.value as JobStatus)}
          aria-label={`Status of ${job.role} at ${job.company}`}
          disabled={pending}
          className="skin-pill max-w-[8.5rem] cursor-pointer border border-hairline bg-surface px-2 py-1 text-xs text-ink-2 outline-none focus-visible:outline-2 focus-visible:outline-accent"
        >
          {JOB_STATUS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
    </li>
  );
});
