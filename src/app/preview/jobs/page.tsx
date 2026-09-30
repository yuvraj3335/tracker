import { notFound } from 'next/navigation';
import type { DimensionScores, EvaluationReport, Job, JobJudgment } from '@/lib/jobs';
import { EMPTY_PROFILE, NO_JUDGMENT, computeMatch, levelFitFor, pipelineSummary, verdictFor } from '@/lib/jobs';
import type { EvalDepth, HardStop, Legitimacy, RedFlag, RoleFamily } from '@/lib/schema';
import { requestTime, shiftKey, todayKey } from '@/lib/date';
import { PageHeader } from '@/components/page-header';
import { Pipeline } from '@/components/jobs/pipeline';
import { PipelineSummary } from '@/components/jobs/pipeline-summary';
import { NeedsAttention } from '@/components/jobs/needs-attention';
import { JobDetail } from '@/components/jobs/job-detail';
import { JobSearchCard } from '@/components/jobs/job-search-card';
import { ProfileForm } from '@/components/jobs/profile-form';
import { ConnectAI } from '@/components/jobs/connect-ai';
import { SetupJobs } from '@/components/jobs/setup-jobs';
import { NewJobForm } from '@/components/jobs/new-job-form';
import { EmptyPipeline } from '@/components/jobs/empty-states';
import { JobDetailSkeleton, JobsSkeleton } from '@/components/skeletons';

/**
 * Dev-only harness for the job screens, with sample data — the same idea as
 * /preview. Writes from here fail harmlessly: there is no tenant behind them.
 * `?only=<section>` renders one section, for screenshots.
 */
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Jobs preview · dev only' };

/** A judgment the way the tracker would compute it, so the preview never drifts from the rubric. */
function judged(
  depth: EvalDepth,
  scores: DimensionScores,
  o: { hardStops?: HardStop[]; redFlags?: RedFlag[]; legitimacy?: Legitimacy | null; roleFamily?: RoleFamily; skillGaps?: string[]; on: string },
): JobJudgment {
  const match = computeMatch(scores, o.redFlags ?? [], o.hardStops ?? []);
  return {
    ...NO_JUDGMENT,
    match,
    verdict: verdictFor({ match, depth, hardStops: o.hardStops, legitimacy: o.legitimacy }),
    levelFit: levelFitFor(scores.level),
    legitimacy: o.legitimacy ?? null,
    hardStops: o.hardStops ?? [],
    redFlags: o.redFlags ?? [],
    roleFamily: o.roleFamily ?? null,
    skillGaps: o.skillGaps ?? [],
    scores,
    evaluation: depth,
    evaluatedOn: o.on,
    reportUrl: depth === 'Full' ? 'https://www.notion.so/Evaluation-0123456789abcdef0123456789abcdef' : null,
  };
}

function sampleReport(today: string): EvaluationReport {
  return {
    summary: 'Strong backend fit on payments APIs; Java and Spring Boot are the gap, and the team says it trains for them.',
    byline: `Rubric v1 · Full evaluation · ${today} · by Claude Code`,
    scores: { skills: 4, level: 5, location: 5, pay: 4, role: 4 },
    notes: {
      skills: 'Node.js services, Postgres and REST map directly; no Java yet',
      level: '"0–2 years", SDE-1 band',
      location: 'Bengaluru, hybrid — both in the profile',
      pay: '₹14–20 LPA stated, above the 12 LPA target',
      role: 'Target company, backend role',
    },
    requirements: [
      { requirement: 'REST APIs in a JVM or Node.js stack', weight: 'Must', match: 'Strong', evidence: 'Built the rate-limiter and webhook services in Node.js' },
      { requirement: 'SQL and relational modelling', weight: 'Must', match: 'Strong', evidence: 'Designed the Postgres schema for the integrations platform' },
      { requirement: 'Java and Spring Boot', weight: 'Core', match: 'Missing', evidence: 'Not on the resume; say you are picking it up' },
      { requirement: 'Production on-call', weight: 'Nice', match: 'Partial', evidence: 'Shared the pager for the webhook service' },
    ],
    levelStrategy: 'On-level: the band is 0–2 years. Lead with shipped services, not coursework.',
    payNotes: ['Posted: "₹14–20 LPA"', 'Ask how much is fixed, and whether there is a joining bonus'],
    legitimacySignals: ['Posted 3 days ago', 'Listed on Visa careers (Workday), not only on job boards', 'Specific stack and team'],
    resumeEdits: ['Put the rate-limiter first: it is a payments-shaped problem', 'Name Postgres and REST in the summary line'],
    keywords: ['REST', 'Spring Boot', 'SQL', 'payments', 'microservices'],
    posting: 'Visa is hiring a Software Engineer to build payment APIs used by millions of merchants.\n\nYou will design and build REST services in Java and Spring Boot, and own reliability for a high-volume payments path.',
  };
}

function sample(): Job[] {
  const t = todayKey();
  const base: Omit<Job, 'id' | 'role' | 'company' | 'status'> = {
    ...NO_JUDGMENT,
    source: 'LinkedIn', location: 'Bengaluru, Karnataka, India', workMode: 'Hybrid', jobUrl: 'https://www.linkedin.com/jobs/view/4471646111/',
    applyUrl: null, fit: '', howToApply: '', salary: '', experience: '', skills: [], postedOn: shiftKey(t, -3),
    appliedOn: null, appliedVia: null, resume: '', referral: '', contact: '', nextStep: '', followUpOn: null, notes: '',
    foundOn: shiftKey(t, -1), lastUpdate: t, heardBackOn: null, addedBy: 'AI', key: '', notionUrl: 'https://www.notion.so/x', createdAt: new Date().toISOString(),
  };
  return [
    { ...base, id: 'j1', role: 'Software Engineer I', company: 'Visa', status: 'Found', source: 'Workday', experience: '0–2 yrs', salary: '₹14–20 LPA', skills: ['Java', 'Spring Boot', 'SQL', 'REST'],
      ...judged('Full', { skills: 4, level: 5, location: 5, pay: 4, role: 4 }, { legitimacy: 'High', roleFamily: 'Backend', skillGaps: ['Java', 'Spring Boot'], on: shiftKey(t, -1) }),
      posting: 'Open', checkedOn: shiftKey(t, -1),
      jobUrl: 'https://visa.wd5.myworkdayjobs.com/Visa/job/IN---Bengaluru-India/Software-Engineer_REF088484W',
      fit: 'Backend-heavy role on payments APIs; your Node.js services and Postgres work map directly. Gap: no Java yet — worth saying you are picking it up.',
      howToApply: '1. Apply on Visa careers (Workday): https://visa.wd5.myworkdayjobs.com/Visa/job/IN---Bengaluru-India/Software-Engineer_REF088484W\n2. Lead with the integrations platform and the rate-limiter work — both are payment-shaped problems.\n3. Ask for a referral first; Visa weighs them.\n4. Expect a HackerRank OA within a week.' },
    { ...base, id: 'j2', role: 'SDE 1, Payments', company: 'Razorpay', status: 'Found', source: 'Naukri', salary: '12-18 Lacs PA', location: 'Bengaluru',
      fit: 'Payments backend at SDE-1 level; read the posting for the stack before deciding.',
      ...judged('Quick', { skills: 4, level: 5, location: 5, pay: null, role: 4 }, { roleFamily: 'Backend', on: t }), posting: 'Closed', checkedOn: t },
    { ...base, id: 'j10', role: 'Senior Software Engineer', company: 'Globex Staffing', status: 'Found', source: 'LinkedIn', location: 'Hyderabad', experience: '5+ years',
      fit: 'Five years required, through a staffing vendor.',
      ...judged('Quick', { skills: 3, level: 1, location: 2, pay: null, role: 3 }, { hardStops: ['Needs more experience'], redFlags: ['Staffing or contract'], legitimacy: 'Caution', roleFamily: 'Full-stack', on: t }) },
    { ...base, id: 'j3', role: 'Backend Engineer', company: 'Postman', status: 'Shortlisted', source: 'Greenhouse', workMode: 'Remote', location: 'Remote, India',
      ...judged('Full', { skills: 3, level: 4, location: 5, pay: null, role: 4 }, { legitimacy: 'High', roleFamily: 'Backend', skillGaps: ['Kafka'], on: shiftKey(t, -2) }) },
    { ...base, id: 'j4', role: 'Software Engineer', company: 'Stripe', status: 'Assessment', source: 'Greenhouse', appliedOn: shiftKey(t, -12), heardBackOn: shiftKey(t, -4), nextStep: 'OA due Friday', followUpOn: t,
      ...judged('Full', { skills: 4, level: 4, location: 5, pay: 4, role: 5 }, { legitimacy: 'High', roleFamily: 'Generalist SDE', on: shiftKey(t, -14) }) },
    { ...base, id: 'j5', role: 'Member of Technical Staff', company: 'Sarvam AI', status: 'Interviewing', source: 'Ashby', appliedOn: shiftKey(t, -20), heardBackOn: shiftKey(t, -10), nextStep: 'Round 2: system design', match: 74 },
    { ...base, id: 'j6', role: 'Software Engineer II', company: 'Walmart Global Tech', status: 'Applied', source: 'Workday', appliedOn: shiftKey(t, -9), appliedVia: 'Referral',
      ...judged('Full', { skills: 4, level: 3, location: 5, pay: null, role: 4 }, { legitimacy: 'High', roleFamily: 'Backend', on: shiftKey(t, -10) }) },
    { ...base, id: 'j7', role: 'Full Stack Developer', company: 'Acme Services', status: 'Applied', source: 'foundit', appliedOn: shiftKey(t, -25), location: 'Pune',
      ...judged('Quick', { skills: 3, level: 4, location: 3, pay: null, role: 3 }, { redFlags: ['Only on job boards'], legitimacy: 'Caution', on: shiftKey(t, -26) }) },
    { ...base, id: 'j8', role: 'Associate Software Engineer', company: 'Groww', status: 'Rejected', source: 'Greenhouse', appliedOn: shiftKey(t, -30), heardBackOn: shiftKey(t, -15) },
    { ...base, id: 'j9', role: 'Software Engineer', company: 'CRED', status: 'Offer', source: 'Lever', appliedOn: shiftKey(t, -40), heardBackOn: shiftKey(t, -30),
      ...judged('Full', { skills: 5, level: 5, location: 5, pay: 4, role: 4 }, { legitimacy: 'High', roleFamily: 'Backend', on: shiftKey(t, -41) }) },
  ];
}

export default async function JobsPreview({ searchParams }: { searchParams: Promise<{ only?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { only } = await searchParams;
  const show = (id: string) => !only || only === id;
  const today = todayKey();
  const now = requestTime();
  const jobs = sample();
  const s = pipelineSummary(jobs, today);
  return (
    <div className="space-y-8">
      <div className="skin-card border border-hairline bg-surface-2 px-4 py-2.5 text-xs text-ink-2">
        <strong>Jobs preview.</strong> Sample data. Development only.
      </div>
      {show('dashboard') ? <Section title="Dashboard card"><JobSearchCard summary={s} /></Section> : null}
      {show('pipeline') ? (
        <Section title="Pipeline">
          <div className="space-y-4">
            <PageHeader title="Jobs" sub="2 to act on · 6 applied · 2 in process" />
            <PipelineSummary summary={s} />
            <NeedsAttention items={s.followUps} closed={s.closedPostings} />
            <Pipeline jobs={jobs} today={today} />
          </div>
        </Section>
      ) : null}
      {show('detail') ? (
        <Section title="Job detail">
          <JobDetail
            job={jobs[0]}
            today={today}
            report={sampleReport(shiftKey(today, -1))}
            description={[
              { type: 'paragraph', text: 'Visa is hiring a Software Engineer to build payment APIs used by millions of merchants.' },
              { type: 'heading', text: 'What you will do' },
              { type: 'bullet', text: 'Design and build REST services in Java and Spring Boot' },
              { type: 'bullet', text: 'Own reliability for a high-volume payments path' },
            ]}
            timeline={[
              { date: shiftKey(today, -1), kind: 'found', text: 'on Workday, added by Claude Code' },
              { date: shiftKey(today, -1), kind: 'evaluated', text: '88% · Apply · full evaluation, rubric v1 (by Claude Code)' },
              { date: today, kind: 'note', text: 'Ravi can refer — asked on Slack' },
            ]}
          />
        </Section>
      ) : null}
      {show('detail-skip') ? (
        <Section title="Job detail: a quick look that says Skip">
          <JobDetail job={jobs.find((j) => j.id === 'j10')!} today={today} report={null} description={[]} timeline={[{ date: today, kind: 'evaluated', text: '50% · Skip · quick look, rubric v1 (by Codex)' }]} />
        </Section>
      ) : null}
      {show('detail-new') ? (
        <Section title="Job detail: saved before the rubric">
          <JobDetail job={jobs.find((j) => j.id === 'j5')!} today={today} report={null} description={[]} timeline={[]} />
        </Section>
      ) : null}
      {show('setup') ? <Section title="Setup"><SetupJobs /></Section> : null}
      {show('empty') ? <Section title="Empty pipeline"><EmptyPipeline connected /></Section> : null}
      {show('new') ? <Section title="Add a job"><NewJobForm /></Section> : null}
      {show('profile') ? (
        <Section title="Profile">
          <ProfileForm profile={{ ...EMPTY_PROFILE, targetRoles: 'SDE-1, Software Engineer', locations: 'Bengaluru, Remote (India)', experience: '1 year', workModes: ['Remote', 'Hybrid'] }} />
        </Section>
      ) : null}
      {show('connect') ? (
        <Section title="Connect AI">
          <ConnectAI
            origin="https://tracker-one-xi-95.vercel.app"
            now={now}
            keys={[
              { id: '00000000-0000-0000-0000-000000000001', userId: 'u', name: 'MacBook', prefix: 'jt_AbCdEfG', createdAt: new Date(now).toISOString(), lastUsedAt: new Date(now - 12 * 60_000).toISOString(), revokedAt: null },
              { id: '00000000-0000-0000-0000-000000000002', userId: 'u', name: 'claude.ai', prefix: 'jt_XyZ1234', createdAt: new Date(now).toISOString(), lastUsedAt: null, revokedAt: null },
            ]}
          />
        </Section>
      ) : null}
      {show('loading') ? (
        <Section title="Loading">
          <div className="space-y-8">
            <JobsSkeleton />
            <JobDetailSkeleton />
          </div>
        </Section>
      ) : null}
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
