import Link from 'next/link';
import { JOB_GROUPS, type PipelineSummary as Summary } from '@/lib/jobs';
import { Card, CardContent } from '../ui/card';
import { Dot, GROUP_COLOR } from './job-ui';

/**
 * The whole pipeline in one line: a segment per stage, sized by how many jobs
 * are in it, with the counts in text beside it — the bar reinforces, the
 * numbers carry. Each stage links to the board filtered to it.
 */
export function PipelineSummary({ summary: s }: { summary: Summary }) {
  const groups = JOB_GROUPS.map((g) => ({ ...g, n: s.byGroup[g.id] ?? 0 }));
  const total = Math.max(1, s.total);
  const interviewing = s.byStatus.Interviewing + s.byStatus.Assessment;
  const rate = s.applied ? Math.round(s.responseRate * 100) : null;

  return (
    <Card>
      <CardContent className="space-y-3.5 pt-4 sm:pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-sm font-semibold tracking-tight">Pipeline</h2>
          <p className="text-xs text-ink-muted tnum">
            {s.total} job{s.total === 1 ? '' : 's'} tracked
          </p>
        </div>

        {/* The funnel. Every non-empty stage keeps at least a sliver, so a
            single offer among forty found jobs is still visible. */}
        <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={groups.map((g) => `${g.label}: ${g.n}`).join(', ')}>
          {groups
            .filter((g) => g.n > 0)
            .map((g) => (
              <span key={g.id} className="h-full first:rounded-l-full last:rounded-r-full" style={{ background: GROUP_COLOR[g.id], flexGrow: Math.max(g.n / total, 0.04) }} title={`${g.label}: ${g.n}`} />
            ))}
        </div>

        <ul className="grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-6">
          {groups.map((g) => (
            <li key={g.id}>
              <Link href={`/jobs?stage=${g.id}`} className="group block rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                <span className="flex items-center gap-1.5 text-micro font-medium text-ink-muted group-hover:text-ink">
                  <Dot color={GROUP_COLOR[g.id]} />
                  {g.label}
                </span>
                <span className="mt-0.5 block text-lg leading-tight font-semibold tnum">{g.n}</span>
              </Link>
            </li>
          ))}
        </ul>

        <dl className="flex flex-wrap gap-x-5 gap-y-1 border-t border-hairline pt-3 text-xs text-ink-muted">
          {s.worthApplying ? <Fact label="worth applying" value={s.worthApplying} strong /> : null}
          <Fact label="applied" value={s.applied} />
          <Fact label="this week" value={s.appliedLast7Days} />
          <Fact label="interviewing" value={interviewing} />
          <Fact label="heard back" value={rate === null ? '—' : `${rate}%`} />
          {s.followUps.length ? <Fact label="to follow up" value={s.followUps.length} strong /> : null}
          {s.notEvaluated ? <Fact label="not evaluated" value={s.notEvaluated} /> : null}
        </dl>
      </CardContent>
    </Card>
  );
}

/** Term before value in the markup, as a description list requires; value first on screen. */
function Fact({ label, value, strong = false }: { label: string; value: number | string; strong?: boolean }) {
  return (
    <div className="flex flex-row-reverse items-baseline justify-end gap-1">
      <dt>{label}</dt>
      <dd className={strong ? 'font-semibold text-ink tnum' : 'font-semibold text-ink-2 tnum'}>{value}</dd>
    </div>
  );
}
