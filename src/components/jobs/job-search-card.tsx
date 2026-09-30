import Link from 'next/link';
import { ArrowRight, Briefcase } from 'lucide-react';
import { JOB_GROUPS, type PipelineSummary } from '@/lib/jobs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { CompanyMark, Dot, FollowUpBadge, GROUP_COLOR } from './job-ui';

/**
 * The job search on the Today page: where the pipeline stands and what is
 * waiting on you, in the space of one card. Shown only once job tracking is
 * set up; before that, a single line invites it.
 */
export function JobSearchCard({ summary }: { summary: PipelineSummary | null }) {
  if (!summary) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4 sm:pt-5">
          <div className="flex min-w-0 items-start gap-2.5">
            <Briefcase className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
            <p className="text-xs text-ink-2">Track your job applications here too — found, applied, interviewing, offer.</p>
          </div>
          <Link href="/jobs" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
            Set up job tracking <ArrowRight className="size-3" />
          </Link>
        </CardContent>
      </Card>
    );
  }
  const stages = JOB_GROUPS.filter((g) => g.id !== 'closed');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Briefcase className="size-3.5 text-ink-muted" aria-hidden />
          Job search
        </CardTitle>
        <CardDescription>
          {summary.applied
            ? `${summary.applied} applied · ${Math.round(summary.responseRate * 100)}% heard back${summary.appliedLast7Days ? ` · ${summary.appliedLast7Days} this week` : ''}${summary.worthApplying ? ` · ${summary.worthApplying} worth applying` : ''}`
            : summary.total
              ? summary.worthApplying
                ? `Nothing applied to yet — ${summary.worthApplying} ${summary.worthApplying === 1 ? 'looks' : 'look'} worth it.`
                : 'Nothing applied to yet — your shortlist is waiting.'
              : 'No jobs yet. Ask your AI tool to find some.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="grid grid-cols-5 gap-2">
          {stages.map((g) => (
            <li key={g.id}>
              <Link href={`/jobs?stage=${g.id}`} className="group block rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                <span className="flex items-center gap-1 text-micro text-ink-muted group-hover:text-ink">
                  <Dot color={GROUP_COLOR[g.id]} />
                  <span className="truncate">{g.label}</span>
                </span>
                <span className="mt-0.5 block text-base leading-tight font-semibold tnum">{summary.byGroup[g.id] ?? 0}</span>
              </Link>
            </li>
          ))}
        </ul>
        {summary.followUps.length ? (
          <ul className="space-y-1.5 border-t border-hairline pt-3">
            {summary.followUps.slice(0, 3).map(({ job, followUp }) => (
              <li key={job.id}>
                <Link href={`/jobs/${job.id}`} className="-mx-1.5 flex items-center gap-2.5 rounded-md px-1.5 py-1 hover:bg-surface-2">
                  <CompanyMark name={job.company || job.role} size={24} />
                  <span className="min-w-0 flex-1 truncate text-xs">
                    <span className="font-medium text-ink">{job.role}</span>
                    <span className="text-ink-muted"> · {job.company}</span>
                  </span>
                  <FollowUpBadge followUp={followUp} />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <Link href="/jobs" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          Open the pipeline <ArrowRight className="size-3" />
        </Link>
      </CardContent>
    </Card>
  );
}
