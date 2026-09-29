import Link from 'next/link';
import { Plus, Sparkles } from 'lucide-react';
import { requireReady } from '@/lib/tenant';
import { getJobs } from '@/lib/jobs-notion';
import { pipelineSummary } from '@/lib/jobs';
import { listApiKeys } from '@/lib/db';
import { todayKey } from '@/lib/date';
import { PageHeader } from '@/components/page-header';
import { StatTile } from '@/components/stat-tile';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { JobsNav } from '@/components/jobs/jobs-nav';
import { JobsBoard } from '@/components/jobs/jobs-board';
import { SetupJobs } from '@/components/jobs/setup-jobs';
import { FollowUpBadge, StatusDot } from '@/components/jobs/job-ui';

// Per-user data: never prerendered, never shared.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Jobs · Job Switch Tracker' };

export default async function JobsPage() {
  const tenant = await requireReady();

  if (!tenant.jobsDs) {
    return (
      <div className="js-content-in space-y-4">
        <PageHeader title="Jobs" sub="Find jobs with your AI tools, and track every application in one place." />
        <SetupJobs />
      </div>
    );
  }

  const today = todayKey();
  const [jobs, keys] = await Promise.all([getJobs(tenant), listApiKeys(tenant.userId).catch(() => [])]);
  const s = pipelineSummary(jobs, today);
  const connected = keys.some((k) => !k.revokedAt);
  const rate = s.applied ? Math.round(s.responseRate * 100) : null;

  return (
    <div className="js-content-in space-y-4">
      <PageHeader
        title="Jobs"
        sub={
          jobs.length
            ? `${s.byGroup.review + s.byGroup.apply} to act on · ${s.applied} applied · ${s.byGroup.process} in process`
            : 'Your job pipeline, from found to offer.'
        }
        right={
          <Button asChild size="sm">
            <Link href="/jobs/new">
              <Plus className="size-3.5" /> Add
            </Link>
          </Button>
        }
      />
      <JobsNav />

      {!connected ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4 sm:pt-5">
            <div className="flex min-w-0 items-start gap-2.5">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              <p className="text-xs text-ink-2">
                Connect Claude Code, Codex, Gemini or Claude Desktop, then ask it to “find SDE jobs in Bengaluru”.
                It searches the job boards and saves the good ones here with how to apply.
              </p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/jobs/connect">Connect an AI tool</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        <StatTile label="To review" value={s.byGroup.review} sub="found for you" />
        <StatTile label="To apply" value={s.byGroup.apply} sub="shortlisted" />
        <StatTile label="Applied" value={s.applied} sub={s.appliedLast7Days ? `${s.appliedLast7Days} this week` : 'total'} />
        <StatTile label="Heard back" value={rate === null ? '—' : `${rate}%`} sub={`${s.heardBack} of ${s.applied}`} />
      </div>

      {s.followUps.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Follow-ups</CardTitle>
            <CardDescription>Dates that have arrived, and applications that have gone quiet.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0 sm:px-0 sm:pb-0">
            <ul>
              {s.followUps.slice(0, 6).map(({ job, followUp }) => (
                <li key={job.id} className="flex items-center gap-3 border-t border-hairline px-4 py-2.5 sm:px-5">
                  <StatusDot status={job.status} />
                  <Link href={`/jobs/${job.id}`} className="min-w-0 flex-1 truncate text-sm hover:text-accent">
                    <span className="font-medium text-ink">{job.role}</span>
                    <span className="text-ink-muted"> · {job.company}</span>
                  </Link>
                  <FollowUpBadge followUp={followUp} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {jobs.length ? (
        <JobsBoard jobs={jobs} today={today} />
      ) : (
        <Card>
          <CardContent className="space-y-2 pt-5 text-center">
            <p className="text-sm font-medium">No jobs yet</p>
            <p className="text-xs text-ink-muted">
              Ask a connected AI tool to find jobs for you, or add one you found yourself.
            </p>
            <div className="flex justify-center gap-2 pt-1">
              <Button asChild size="sm">
                <Link href="/jobs/new">Add a job</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/jobs/connect">Connect an AI tool</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
