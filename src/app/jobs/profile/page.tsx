import { redirect } from 'next/navigation';
import { requireReady } from '@/lib/tenant';
import { getProfile } from '@/lib/jobs-notion';
import { EMPTY_PROFILE } from '@/lib/jobs';
import { PageHeader } from '@/components/page-header';
import { JobsNav } from '@/components/jobs/jobs-nav';
import { ProfileForm } from '@/components/jobs/profile-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Job profile · Job Switch Tracker' };

export default async function ProfilePage() {
  const tenant = await requireReady();
  if (!tenant.jobsDs) redirect('/jobs');
  const profile = (await getProfile(tenant)) ?? EMPTY_PROFILE;
  return (
    <div className="js-content-in space-y-4">
      <PageHeader title="Job profile" sub="Kept in your own Notion. Every search is tailored to it." />
      <JobsNav />
      <ProfileForm profile={profile} />
    </div>
  );
}
