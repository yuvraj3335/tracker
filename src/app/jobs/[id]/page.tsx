import { notFound, redirect } from 'next/navigation';
import { requireReady } from '@/lib/tenant';
import { getJob, isNotionId } from '@/lib/jobs/notion';
import { todayKey } from '@/lib/date';
import { JobDetail } from '@/components/jobs/job-detail';

export const dynamic = 'force-dynamic';

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const tenant = await requireReady();
  if (!tenant.jobsDs) redirect('/jobs');
  const { id } = await params;
  if (!isNotionId(id)) notFound();
  // getJob checks the page belongs to this account's Job Applications — an id
  // from the URL could name any page in the workspace.
  const detail = await getJob(tenant, id);
  if (!detail) notFound();
  return (
    <div className="js-content-in">
      <JobDetail job={detail.job} description={detail.description} timeline={detail.timeline} report={detail.report} today={todayKey()} />
    </div>
  );
}
