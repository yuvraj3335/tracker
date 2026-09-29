import { redirect } from 'next/navigation';
import { requireReady } from '@/lib/tenant';
import { PageHeader } from '@/components/page-header';
import { JobsNav } from '@/components/jobs/jobs-nav';
import { NewJobForm } from '@/components/jobs/new-job-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Add a job · Job Switch Tracker' };

export default async function NewJobPage() {
  const tenant = await requireReady();
  if (!tenant.jobsDs) redirect('/jobs');
  return (
    <div className="js-content-in space-y-4">
      <PageHeader title="Add a job" sub="Saved to your Notion, with the same duplicate check your AI tools get." />
      <JobsNav />
      <NewJobForm />
    </div>
  );
}
