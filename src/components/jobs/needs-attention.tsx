'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { BellRing, Loader2 } from 'lucide-react';
import { followedUpAction, setJobStatusAction, snoozeAction, type ActionState } from '@/app/jobs/actions';
import type { FollowUp, Job } from '@/lib/jobs';
import { reportProblem } from '@/lib/undo';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { CompanyMark, FollowUpBadge } from './job-ui';
import { cn } from '@/lib/utils';

/**
 * What is waiting on you: follow-up dates that have arrived, a week of silence
 * after applying, and three-week silences that are probably ghosted. Each row
 * offers the one action that clears it, so the list empties as you work.
 */
export function NeedsAttention({ items }: { items: { job: Job; followUp: FollowUp }[] }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const rows = items.filter((i) => !done.has(i.job.id)).slice(0, 6);
  if (!rows.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <BellRing className="size-3.5 text-ink-muted" aria-hidden />
          Needs attention
        </CardTitle>
        <CardDescription>Follow-ups that are due, and applications that have gone quiet.</CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-0 sm:px-0 sm:pb-0">
        <ul>
          {rows.map(({ job, followUp }) => (
            <Row key={job.id} job={job} followUp={followUp} onCleared={() => setDone((d) => new Set(d).add(job.id))} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Row({ job, followUp, onCleared }: { job: Job; followUp: FollowUp; onCleared: () => void }) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionState>) =>
    start(async () => {
      const r = await fn();
      if (r?.ok) onCleared();
      else reportProblem(r?.message ?? 'That did not save.');
    });
  // One line on a laptop. On a phone the badge and actions drop below the
  // role — beside it they cut "Full Stack Developer" down to "Full Stack…".
  return (
    <li className={cn('flex items-start gap-3 border-t border-hairline px-4 py-3 sm:items-center sm:px-5', pending && 'opacity-60')}>
      <CompanyMark name={job.company || job.role} size={30} className="mt-0.5 sm:mt-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <Link href={`/jobs/${job.id}`} className="min-w-0 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent sm:flex-1">
          <span className="block truncate text-sm font-medium text-ink">{job.role}</span>
          <span className="block truncate text-xs text-ink-muted">{job.company}</span>
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <FollowUpBadge followUp={followUp} />
          <span className="flex items-center gap-1">
            {pending ? <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-label="Saving" /> : null}
            {followUp.kind === 'stale' ? (
              <Action onClick={() => run(() => setJobStatusAction(job.id, 'Ghosted'))} disabled={pending}>
                Mark ghosted
              </Action>
            ) : (
              <Action onClick={() => run(() => followedUpAction(job.id))} disabled={pending} primary>
                Followed up
              </Action>
            )}
            <Action onClick={() => run(() => snoozeAction(job.id, 7))} disabled={pending}>
              Snooze a week
            </Action>
          </span>
        </div>
      </div>
    </li>
  );
}

function Action({ children, onClick, disabled, primary = false }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'skin-pill px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-50',
        primary ? 'bg-accent text-accent-ink hover:opacity-90' : 'border border-hairline text-ink-2 hover:bg-surface-2 hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
