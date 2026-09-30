'use client';

import { memo } from 'react';
import Link from 'next/link';
import { ExternalLink, MapPin } from 'lucide-react';
import { followUpFor, type Job } from '@/lib/jobs';
import type { JobStatus } from '@/lib/schema';
import type { DayKey } from '@/lib/date';
import {
  Chip,
  CompanyMark,
  FollowUpBadge,
  HardStopChip,
  LegitimacyBadge,
  MatchBadge,
  PostingBadge,
  RedFlagChip,
  StatusSelect,
  VerdictBadge,
  ago,
  safeHref,
} from './job-ui';
import { cn } from '@/lib/utils';

/** The one line of time that matters most for where the job is. */
function when(job: Job, today: DayKey): string {
  if (job.appliedOn) return `Applied ${ago(job.appliedOn, today)}`;
  if (job.postedOn) return `Posted ${ago(job.postedOn, today)}`;
  if (job.foundOn) return `Added ${ago(job.foundOn, today)}`;
  return '';
}

/** "Bengaluru, Karnataka, India" → "Bengaluru": the city is what a card has room for. */
const city = (location: string) => location.split(/[,/•|]/)[0].replace(/^in office\s*/i, '').trim();

/** The city chip, unless it would only repeat the work mode ("Remote" twice). */
function placeChip(job: Job): string | null {
  const c = job.location ? city(job.location) : '';
  if (!c) return null;
  return job.workMode && c.toLowerCase() === job.workMode.toLowerCase() ? null : c;
}

/**
 * A job on the board: small, draggable between columns, and a link to the
 * whole job. The status is changed by dragging, or on the job's page.
 */
export const JobTile = memo(function JobTile({
  job,
  today,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  job: Job;
  today: DayKey;
  dragging: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  const followUp = followUpFor(job, today);
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/x-job-id', job.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(job.id);
      }}
      onDragEnd={onDragEnd}
      className={cn('js-lift skin-card group relative border border-hairline bg-surface transition-opacity', dragging && 'opacity-40')}
    >
      <Link
        href={`/jobs/${job.id}`}
        className="block space-y-2 rounded-[inherit] p-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        draggable={false}
      >
        <div className="flex items-start gap-2.5">
          <CompanyMark name={job.company || job.role} size={28} />
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm leading-snug font-medium text-ink">{job.role}</p>
            <p className="truncate text-xs text-ink-muted">{job.company}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <VerdictBadge verdict={job.verdict} depth={job.evaluation} />
          <MatchBadge match={job.match} />
          {placeChip(job) ? <Chip icon={<MapPin className="size-2.5 shrink-0" />}>{placeChip(job)}</Chip> : null}
          {job.workMode ? <Chip>{job.workMode}</Chip> : null}
          {job.hardStops[0] ? <HardStopChip>{job.hardStops[0]}</HardStopChip> : null}
          <PostingBadge posting={job.posting} />
          <LegitimacyBadge legitimacy={job.legitimacy} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <span className="text-micro text-ink-muted tnum">{when(job, today)}</span>
          <FollowUpBadge followUp={followUp} />
        </div>
      </Link>
    </li>
  );
});

/**
 * A job in the list: everything the board shows plus the source, pay and next
 * step, with the status control and the posting link at the end of the row.
 */
export const JobRow = memo(function JobRow({
  job,
  today,
  pending,
  onMove,
}: {
  job: Job;
  today: DayKey;
  pending: boolean;
  onMove: (job: Job, next: JobStatus) => void;
}) {
  const followUp = followUpFor(job, today);
  const href = safeHref(job.applyUrl) ?? safeHref(job.jobUrl);
  const place = placeChip(job);
  // The controls sit at the end of the row on a laptop, and on their own line
  // on a phone — beside the title they squeezed it to two words a line.
  const controls = (
    <>
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
      <StatusSelect value={job.status} onChange={(next) => onMove(job, next)} label={`Status of ${job.role} at ${job.company}`} disabled={pending} />
    </>
  );
  return (
    <li className={cn('group flex items-start gap-3 border-b border-hairline px-3 py-3 transition-colors last:border-0 hover:bg-surface-2/40 sm:px-4', pending && 'opacity-60')}>
      <CompanyMark name={job.company || job.role} size={36} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link
              href={`/jobs/${job.id}`}
              className="text-sm font-medium text-ink underline-offset-2 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {job.role}
            </Link>
            <p className="text-xs text-ink-muted">{job.company}</p>
          </div>
          <div className="hidden shrink-0 items-center gap-1 sm:flex">{controls}</div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <VerdictBadge verdict={job.verdict} depth={job.evaluation} />
          <MatchBadge match={job.match} />
          {place ? <Chip icon={<MapPin className="size-2.5 shrink-0" />} title={job.location}>{place}</Chip> : null}
          {job.workMode ? <Chip>{job.workMode}</Chip> : null}
          {job.source ? <Chip>{job.source}</Chip> : null}
          {job.salary ? <Chip>{job.salary}</Chip> : null}
          {job.experience ? <Chip>{job.experience}</Chip> : null}
          {job.hardStops.slice(0, 2).map((h) => (
            <HardStopChip key={h}>{h}</HardStopChip>
          ))}
          {job.redFlags.slice(0, 2).map((f) => (
            <RedFlagChip key={f}>{f}</RedFlagChip>
          ))}
          <PostingBadge posting={job.posting} />
          <LegitimacyBadge legitimacy={job.legitimacy} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta text-ink-muted">
          <span className="tnum">{when(job, today)}</span>
          {job.nextStep ? <span className="text-ink-2">Next: {job.nextStep}</span> : null}
          <FollowUpBadge followUp={followUp} />
        </div>
        <div className="mt-2 flex items-center justify-end gap-1 sm:hidden">{controls}</div>
      </div>
    </li>
  );
});
