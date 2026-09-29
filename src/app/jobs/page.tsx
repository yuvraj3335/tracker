import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requireReady } from '@/lib/tenant';
import { getJobs } from '@/lib/jobs/notion';
import { JOB_GROUPS, pipelineSummary } from '@/lib/jobs';
import { listApiKeys } from '@/lib/db';
import { todayKey } from '@/lib/date';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { JobsNav } from '@/components/jobs/jobs-nav';
import { Pipeline, type Stage } from '@/components/jobs/pipeline';
import { PipelineSummary } from '@/components/jobs/pipeline-summary';
import { NeedsAttention } from '@/components/jobs/needs-attention';
import { SetupJobs } from '@/components/jobs/setup-jobs';
import { ConnectNudge, EmptyPipeline } from '@/components/jobs/empty-states';

// Per-user data: never prerendered, never shared.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Jobs · Job Switch Tracker' };

const STAGES = new Set<string>(['open', 'all', ...JOB_GROUPS.map((g) => g.id)]);

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ stage?: string }> }) {
  const tenant = await requireReady();

  if (!tenant.jobsDs) {
    return (
      <div className="js-content-in space-y-4">
        <PageHeader title="Jobs" sub="Find jobs with your AI tools, and track every application in one place." />
        <SetupJobs />
      </div>
    );
  }

  const { stage } = await searchParams;
  const today = todayKey();
  const [jobs, keys] = await Promise.all([getJobs(tenant), listApiKeys(tenant.userId).catch(() => [])]);
  const s = pipelineSummary(jobs, today);
  const connected = keys.some((k) => !k.revokedAt);
  const toAct = (s.byGroup.review ?? 0) + (s.byGroup.apply ?? 0);

  return (
    <div className="js-content-in space-y-4">
      <PageHeader
        title="Jobs"
        sub={
          jobs.length
            ? `${toAct} to act on · ${s.applied} applied · ${s.byGroup.process ?? 0} in process`
            : 'Your job pipeline, from found to offer.'
        }
        right={
          <Button asChild size="sm">
            <Link href="/jobs/new">
              <Plus className="size-3.5" /> Add a job
            </Link>
          </Button>
        }
      />
      <JobsNav />

      {!connected ? <ConnectNudge /> : null}

      {jobs.length ? (
        <>
          <PipelineSummary summary={s} />
          <NeedsAttention items={s.followUps} />
          <Pipeline jobs={jobs} today={today} initialStage={stage && STAGES.has(stage) ? (stage as Stage) : 'open'} />
        </>
      ) : (
        <EmptyPipeline connected={connected} />
      )}
    </div>
  );
}
