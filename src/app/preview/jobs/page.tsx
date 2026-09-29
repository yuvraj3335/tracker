import { notFound } from 'next/navigation';
import type { Job } from '@/lib/jobs';
import { EMPTY_PROFILE, pipelineSummary } from '@/lib/jobs';
import { shiftKey, todayKey } from '@/lib/date';
import { PageHeader } from '@/components/page-header';
import { StatTile } from '@/components/stat-tile';
import { JobsBoard } from '@/components/jobs/jobs-board';
import { JobDetail } from '@/components/jobs/job-detail';
import { ProfileForm } from '@/components/jobs/profile-form';
import { ConnectAI } from '@/components/jobs/connect-ai';
import { SetupJobs } from '@/components/jobs/setup-jobs';
import { NewJobForm } from '@/components/jobs/new-job-form';
import { JobsSkeleton } from '@/components/skeletons';

/**
 * Dev-only harness for the job screens, with sample data — the same idea as
 * /preview. Writes from here fail harmlessly: there is no tenant behind them.
 */
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Jobs preview · dev only' };

function sample(): Job[] {
  const t = todayKey();
  const base: Omit<Job, 'id' | 'role' | 'company' | 'status'> = {
    source: 'LinkedIn', location: 'Bengaluru, Karnataka, India', workMode: 'Hybrid', jobUrl: 'https://www.linkedin.com/jobs/view/4471646111/',
    applyUrl: null, match: null, fit: '', howToApply: '', salary: '', experience: '', skills: [], postedOn: shiftKey(t, -3),
    appliedOn: null, appliedVia: null, resume: '', referral: '', contact: '', nextStep: '', followUpOn: null, notes: '',
    foundOn: shiftKey(t, -1), lastUpdate: t, heardBackOn: null, addedBy: 'AI', key: '', notionUrl: 'https://www.notion.so/x', createdAt: new Date().toISOString(),
  };
  return [
    { ...base, id: 'j1', role: 'Software Engineer I', company: 'Visa', status: 'Found', source: 'Workday', match: 86, experience: '0–2 yrs',
      fit: 'Backend-heavy role on payments APIs; your Node.js and Postgres work maps directly. Gap: no Java yet.',
      howToApply: '1. Apply on Visa careers (Workday) — the direct link is saved.\n2. Lead with the integrations platform and the rate-limiter work.\n3. Ask Ravi for a referral; Visa weighs them.\n4. Expect a HackerRank OA within a week.' },
    { ...base, id: 'j2', role: 'SDE 1, Payments', company: 'Razorpay', status: 'Shortlisted', source: 'Naukri', match: 78, salary: '12-18 Lacs PA' },
    { ...base, id: 'j3', role: 'Backend Engineer', company: 'Postman', status: 'Applied', source: 'Greenhouse', appliedOn: shiftKey(t, -9), appliedVia: 'Referral', match: 72 },
    { ...base, id: 'j4', role: 'Software Engineer', company: 'Stripe', status: 'Assessment', source: 'Greenhouse', appliedOn: shiftKey(t, -12), heardBackOn: shiftKey(t, -4), nextStep: 'OA due Friday', followUpOn: t, match: 81 },
    { ...base, id: 'j5', role: 'Member of Technical Staff', company: 'Sarvam AI', status: 'Interviewing', source: 'Ashby', appliedOn: shiftKey(t, -20), heardBackOn: shiftKey(t, -10), nextStep: 'Round 2: system design' },
    { ...base, id: 'j6', role: 'Software Engineer', company: 'Groww', status: 'Rejected', source: 'Greenhouse', appliedOn: shiftKey(t, -30), heardBackOn: shiftKey(t, -15) },
    { ...base, id: 'j7', role: 'Full Stack Developer', company: 'Acme Services', status: 'Applied', source: 'foundit', appliedOn: shiftKey(t, -25), match: 55 },
  ];
}

export default function JobsPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  const today = todayKey();
  const jobs = sample();
  const s = pipelineSummary(jobs, today);
  return (
    <div className="space-y-8">
      <div className="skin-card border border-hairline bg-surface-2 px-4 py-2.5 text-xs text-ink-2">
        <strong>Jobs preview.</strong> Sample data. Development only.
      </div>
      <Section title="Setup card"><SetupJobs /></Section>
      <Section title="Pipeline">
        <div className="space-y-4">
          <PageHeader title="Jobs" sub="2 to act on · 5 applied · 2 in process" />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
            <StatTile label="To review" value={s.byGroup.review} sub="found for you" />
            <StatTile label="To apply" value={s.byGroup.apply} sub="shortlisted" />
            <StatTile label="Applied" value={s.applied} sub="total" />
            <StatTile label="Heard back" value={`${Math.round(s.responseRate * 100)}%`} sub={`${s.heardBack} of ${s.applied}`} />
          </div>
          <JobsBoard jobs={jobs} today={today} />
        </div>
      </Section>
      <Section title="Job detail">
        <JobDetail
          job={jobs[0]}
          today={today}
          description={[{ type: 'paragraph', text: 'Visa is hiring a Software Engineer to build payment APIs used by millions of merchants.' }, { type: 'bullet', text: 'Node.js or Java, SQL, REST' }]}
          timeline={[{ date: shiftKey(today, -1), kind: 'found', text: 'on Workday, added by Claude Code' }]}
        />
      </Section>
      <Section title="Add a job"><NewJobForm today={today} /></Section>
      <Section title="Profile"><ProfileForm profile={{ ...EMPTY_PROFILE, targetRoles: 'SDE-1, Software Engineer', locations: 'Bengaluru, Remote (India)', experience: '1 year', workModes: ['Remote', 'Hybrid'] }} /></Section>
      <Section title="Connect AI">
        <ConnectAI origin="https://tracker-one-xi-95.vercel.app" keys={[{ id: '00000000-0000-0000-0000-000000000001', userId: 'u', name: 'MacBook', prefix: 'jt_AbCdEfG', createdAt: new Date().toISOString(), lastUsedAt: null, revokedAt: null }]} />
      </Section>
      <Section title="Loading"><JobsSkeleton /></Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}
