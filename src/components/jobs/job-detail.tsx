'use client';

import { useActionState, useOptimistic, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Award,
  Briefcase,
  CalendarClock,
  Check,
  ClipboardList,
  ExternalLink,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Repeat,
  Scale,
  Search,
  Send,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';
import {
  logJobEventAction,
  quickEventAction,
  setJobStatusAction,
  snoozeAction,
  trashJobAction,
  updateJobAction,
  type ActionState,
} from '@/app/jobs/actions';
import { EVENT_LABEL, LOGGABLE_KINDS, followUpFor, isClosed, type EvaluationReport, type Job, type JobEvent, type JobEventKind } from '@/lib/jobs';
import type { BodyBlock } from '@/lib/jobs/notion';
import { APPLIED_VIA, JOB_SOURCES, WORK_MODES, type JobStatus } from '@/lib/schema';
import { formatKey, type DayKey } from '@/lib/date';
import { offerUndo, reportProblem } from '@/lib/undo';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import {
  Chip,
  CompanyMark,
  FollowUpBadge,
  FormMessage,
  LegitimacyBadge,
  MatchBadge,
  RichSteps,
  STATUS_COLOR,
  SelectField,
  StatusSelect,
  TextArea,
  TextField,
  VerdictBadge,
  ago,
  inputClass,
  safeHref,
} from './job-ui';
import { EvaluationReportCard, VerdictCard } from './evaluation-panel';
import { cn } from '@/lib/utils';

/** The happy path, in order. The closed statuses sit outside it. */
const STAGES: JobStatus[] = ['Found', 'Shortlisted', 'Applied', 'Assessment', 'Interviewing', 'Offer'];

export function JobDetail({
  job,
  description,
  timeline,
  report,
  today,
}: {
  job: Job;
  description: BodyBlock[];
  timeline: JobEvent[];
  report: EvaluationReport | null;
  today: DayKey;
}) {
  const [status, setStatus] = useOptimistic(job.status);
  const [moving, startMove] = useTransition();
  const followUp = followUpFor({ ...job, status }, today);
  const apply = safeHref(job.applyUrl) ?? safeHref(job.jobUrl);
  const posting = safeHref(job.jobUrl);
  const notion = safeHref(job.notionUrl);

  function move(next: JobStatus) {
    if (next === status) return;
    const before = status;
    startMove(async () => {
      setStatus(next);
      const r = await setJobStatusAction(job.id, next);
      if (!r?.ok) reportProblem(r?.message ?? 'Could not change the stage.');
      else offerUndo(`Moved to ${next}`, async () => void (await setJobStatusAction(job.id, before)));
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 px-1">
        <Link href="/jobs" className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink">
          <ArrowLeft className="size-3.5" /> Pipeline
        </Link>
        {notion ? (
          <a href={notion} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink">
            Open in Notion <ExternalLink className="size-3" />
          </a>
        ) : null}
      </div>

      {/* ---- header ---- */}
      <section className="skin-card relative overflow-hidden border border-hairline bg-surface shadow-lift-1">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ background: `radial-gradient(90% 120% at 100% 0%, ${STATUS_COLOR[status]} 0%, transparent 55%)` }}
        />
        <div className="relative space-y-4 p-4 sm:p-5">
          <div className="flex items-start gap-3.5">
            <CompanyMark name={job.company || job.role} size={48} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <h1 className="text-lg leading-tight font-semibold tracking-tight sm:text-display">{job.role}</h1>
                {/* Beside the title on a laptop; below it on a phone, where it
                    squeezed a three-word role onto three lines. */}
                <div className="hidden shrink-0 items-center gap-2 sm:flex">
                  <StatusSelect value={status} onChange={move} label="Stage" disabled={moving} size="md" />
                  {moving ? <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-label="Saving" /> : null}
                </div>
              </div>
              <p className="mt-1 text-sm text-ink-2">
                {job.company}
                {job.location ? <span className="text-ink-muted"> · {job.location}</span> : null}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <VerdictBadge verdict={job.verdict} depth={job.evaluation} />
                <MatchBadge match={job.match} />
                <LegitimacyBadge legitimacy={job.legitimacy} />
                {job.workMode ? <Chip>{job.workMode}</Chip> : null}
                {job.source ? <Chip>{job.source}</Chip> : null}
                {job.experience ? <Chip>{job.experience}</Chip> : null}
                {job.salary ? <Chip>{job.salary}</Chip> : null}
                {job.postedOn ? <Chip>Posted {ago(job.postedOn, today)}</Chip> : null}
                <FollowUpBadge followUp={followUp} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:hidden">
            <StatusSelect value={status} onChange={move} label="Stage" disabled={moving} size="md" />
            {moving ? <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-label="Saving" /> : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {apply ? (
              <Button asChild size="sm">
                <a href={apply} target="_blank" rel="noreferrer noopener">
                  Apply{job.source ? ` on ${job.source}` : ''}
                  <ExternalLink className="size-3" />
                </a>
              </Button>
            ) : null}
            {posting && posting !== apply ? (
              <Button asChild size="sm" variant="outline">
                <a href={posting} target="_blank" rel="noreferrer noopener">
                  View posting <ExternalLink className="size-3" />
                </a>
              </Button>
            ) : null}
            <QuickActions id={job.id} status={status} appliedOn={job.appliedOn} />
          </div>

          <StageStepper status={status} onPick={move} disabled={moving} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ---- main ---- */}
        <div className="min-w-0 space-y-4">
          <VerdictCard job={job} report={report} today={today} />
          {job.howToApply ? (
            <Card>
              <CardHeader>
                <CardTitle>How to apply</CardTitle>
              </CardHeader>
              <CardContent>
                <RichSteps text={job.howToApply} />
              </CardContent>
            </Card>
          ) : null}
          {report ? <EvaluationReportCard report={report} /> : null}
          {/* A one-line fit is already the verdict's summary; only more than that earns its own card. */}
          {job.fit && !(job.verdict && !report?.summary && !job.fit.includes('\n')) ? (
            <Card>
              <CardHeader>
                <CardTitle>Why it fits</CardTitle>
              </CardHeader>
              <CardContent>
                <RichSteps text={job.fit} />
              </CardContent>
            </Card>
          ) : null}
          {description.length ? <About blocks={description} /> : null}
          <Details job={job} />
        </div>

        {/* ---- side ---- */}
        <aside className="min-w-0 space-y-4 lg:sticky lg:top-18 lg:self-start">
          <Facts job={job} today={today} />
          <Timeline id={job.id} timeline={timeline} today={today} />
          <Remove id={job.id} role={job.role} />
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage stepper
// ---------------------------------------------------------------------------

/**
 * Where the application is on the happy path, and a way to move it: every
 * step is a button. A closed application shows how it ended, and any step
 * reopens it.
 */
function StageStepper({ status, onPick, disabled }: { status: JobStatus; onPick: (s: JobStatus) => void; disabled: boolean }) {
  const closed = isClosed(status);
  const at = STAGES.indexOf(status);
  return (
    <div className="border-t border-hairline pt-3.5">
      {closed ? (
        <p className="mb-2.5 flex items-center gap-2 text-xs text-ink-2">
          <span className="skin-pill inline-flex items-center gap-1.5 border border-hairline px-2 py-0.5 font-medium">
            <XCircle className="size-3" style={{ color: STATUS_COLOR[status] }} aria-hidden />
            {status}
          </span>
          This application is closed. Pick a stage to reopen it.
        </p>
      ) : null}
      <ol className="-mx-1 flex items-center overflow-x-auto px-1 pb-1" aria-label="Stage">
        {STAGES.map((s, i) => {
          const done = !closed && i < at;
          const current = !closed && i === at;
          return (
            <li key={s} className="flex min-w-0 flex-1 items-center">
              <button
                type="button"
                onClick={() => onPick(s)}
                disabled={disabled || current}
                aria-current={current ? 'step' : undefined}
                className="group flex min-w-8 flex-col items-center gap-1.5 rounded-md px-1 py-1 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default sm:min-w-[4.5rem]"
              >
                <span
                  className={cn(
                    'grid size-6 place-items-center rounded-full border text-micro font-semibold transition-colors',
                    current && 'border-transparent bg-accent text-accent-ink',
                    done && 'border-transparent bg-surface-2 text-ink',
                    !current && !done && 'border-hairline bg-surface text-ink-muted group-hover:border-control',
                  )}
                >
                  {done ? <Check className="size-3" aria-hidden /> : i + 1}
                </span>
                {/* Every label on a laptop; on a phone only the current one,
                    since six labels do not fit a phone's width. */}
                <span className={cn('text-micro whitespace-nowrap', current ? 'font-semibold text-ink' : 'hidden text-ink-muted group-hover:text-ink-2 sm:inline')}>{s}</span>
                {!current ? <span className="sr-only sm:hidden">{s}</span> : null}
              </button>
              {i < STAGES.length - 1 ? (
                <span aria-hidden className={cn('mx-0.5 mb-5 h-px min-w-3 flex-1', !closed && i < at ? 'bg-accent/60' : 'bg-[var(--border)]')} />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick actions: the next thing, one tap
// ---------------------------------------------------------------------------

function QuickActions({ id, status, appliedOn }: { id: string; status: JobStatus; appliedOn: string | null }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionState>) =>
    start(async () => {
      const r = await fn();
      if (!r?.ok) reportProblem(r?.message ?? 'That did not save.');
      else setNote(r.message);
    });
  const event = (kind: JobEventKind) => () => run(() => quickEventAction(id, kind));

  const actions: { label: string; icon: React.ReactNode; onClick: () => void }[] = [];
  if (status === 'Found' || status === 'Shortlisted') {
    actions.push({ label: 'I applied', icon: <Send className="size-3" />, onClick: event('applied') });
    if (status === 'Found') actions.push({ label: 'Shortlist', icon: <Check className="size-3" />, onClick: () => run(() => setJobStatusAction(id, 'Shortlisted')) });
    actions.push({ label: 'Not for me', icon: <XCircle className="size-3" />, onClick: () => run(() => setJobStatusAction(id, 'Skipped')) });
  } else if (status === 'Applied') {
    actions.push({ label: 'They replied', icon: <Mail className="size-3" />, onClick: event('reply') });
    actions.push({ label: 'Got an assessment', icon: <ClipboardList className="size-3" />, onClick: event('assessment') });
    actions.push({ label: 'Follow up in a week', icon: <CalendarClock className="size-3" />, onClick: () => run(() => snoozeAction(id, 7)) });
  } else if (status === 'Assessment' || status === 'Interviewing') {
    actions.push({ label: 'Interview scheduled', icon: <Users className="size-3" />, onClick: event('interview') });
    actions.push({ label: 'Got an offer', icon: <Award className="size-3" />, onClick: event('offer') });
    actions.push({ label: 'Rejected', icon: <XCircle className="size-3" />, onClick: event('rejection') });
  } else if (isClosed(status)) {
    actions.push({ label: 'Reopen', icon: <Repeat className="size-3" />, onClick: () => run(() => setJobStatusAction(id, appliedOn ? 'Applied' : 'Shortlisted')) });
  }
  if (!actions.length) return null;

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          onClick={a.onClick}
          disabled={pending}
          className="skin-pill inline-flex items-center gap-1 border border-hairline bg-surface px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
        >
          {a.icon}
          {a.label}
        </button>
      ))}
      {pending ? <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-label="Saving" /> : null}
      <span className="sr-only" role="status" aria-live="polite">
        {note ?? ''}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

function Facts({ job, today }: { job: Job; today: DayKey }) {
  const day = (d: string | null) => (d ? `${formatKey(d, 'd MMM yyyy')} · ${ago(d, today)}` : null);
  const rows: [string, React.ReactNode | null][] = [
    ['Applied', job.appliedOn ? `${day(job.appliedOn)}${job.appliedVia ? ` · ${job.appliedVia}` : ''}` : null],
    ['Heard back', day(job.heardBackOn)],
    ['Follow up', day(job.followUpOn)],
    ['Next step', job.nextStep || null],
    ['Referral', job.referral || null],
    ['Contact', job.contact || null],
    ['Resume used', job.resume || null],
    ['Salary', job.salary || null],
    ['Experience', job.experience || null],
    ['Posted', day(job.postedOn)],
    ['Found', job.foundOn ? `${day(job.foundOn)}${job.addedBy === 'AI' ? ' · by your AI tool' : ''}` : null],
  ];
  const filled = rows.filter(([, v]) => v);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Briefcase className="size-3.5 text-ink-muted" aria-hidden />
          At a glance
        </CardTitle>
      </CardHeader>
      <CardContent>
        {filled.length ? (
          <dl className="divide-y divide-[var(--border)] text-xs">
            {filled.map(([k, v]) => (
              <div key={k} className="flex gap-3 py-2 first:pt-0 last:pb-0">
                <dt className="w-24 shrink-0 text-ink-muted">{k}</dt>
                <dd className="min-w-0 flex-1 break-words text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-xs text-ink-muted">Nothing recorded yet.</p>
        )}
        {job.skills.length ? (
          <div className="mt-3 flex flex-wrap gap-1 border-t border-hairline pt-3">
            {job.skills.map((s) => (
              <Chip key={s}>{s}</Chip>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

const EVENT_ICON: Record<JobEventKind, React.ComponentType<{ className?: string }>> = {
  note: MessageSquare,
  applied: Send,
  followup: Repeat,
  reply: Mail,
  call: Phone,
  assessment: ClipboardList,
  interview: Users,
  rejection: XCircle,
  offer: Award,
  found: Search,
  status: ArrowRight,
  evaluated: Scale,
};

function Timeline({ id, timeline, today }: { id: string; timeline: JobEvent[]; today: DayKey }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(logJobEventAction.bind(null, id), null);
  const events = [...timeline].reverse();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
        <CardDescription>Log what happened. Events that mean a new stage move it for you.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={action} className="space-y-2">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <select name="kind" defaultValue="reply" aria-label="What happened" className={cn(inputClass, 'cursor-pointer py-1.5 text-xs')}>
              {LOGGABLE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {EVENT_LABEL[k]}
                </option>
              ))}
            </select>
            <input name="date" type="date" defaultValue={today} aria-label="When" className={cn(inputClass, 'py-1.5 text-xs')} />
          </div>
          <input name="text" placeholder="Details, e.g. OA link came by email, due Friday" aria-label="Details" className={cn(inputClass, 'py-1.5 text-xs')} />
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-micro text-ink-muted">
              <input type="checkbox" name="move_status" defaultChecked className="size-3.5 accent-[var(--accent)]" />
              Move the stage to match
            </label>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Log
            </Button>
          </div>
          <FormMessage state={state} />
        </form>

        {events.length ? (
          <ol className="relative space-y-3.5">
            <span aria-hidden className="absolute top-2 bottom-2 left-[11px] w-px bg-[var(--border)]" />
            {events.map((e, i) => {
              const Icon = EVENT_ICON[e.kind] ?? MessageSquare;
              return (
                <li key={i} className="relative flex gap-3">
                  <span className="relative grid size-6 shrink-0 place-items-center rounded-full border border-hairline bg-surface">
                    <Icon className="size-3 text-ink-muted" />
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-xs">
                      <span className="font-semibold text-ink">{EVENT_LABEL[e.kind]}</span>
                      {e.date ? <span className="ml-1.5 text-ink-muted tnum">{formatKey(e.date, 'd MMM')}</span> : null}
                    </p>
                    {e.text ? <p className="mt-0.5 text-xs leading-relaxed break-words text-ink-2">{e.text}</p> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-xs text-ink-muted">Nothing logged yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Description and the edit form
// ---------------------------------------------------------------------------

function About({ blocks }: { blocks: BodyBlock[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>About the role</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm leading-relaxed text-ink-2">
        {blocks.map((b, i) =>
          b.type === 'heading' ? (
            <h3 key={i} className="pt-1 text-sm font-semibold text-ink">
              {b.text}
            </h3>
          ) : b.type === 'bullet' || b.type === 'todo' ? (
            <p key={i} className="flex gap-2 pl-1">
              <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-[var(--ink-muted)]" />
              <span>{b.text}</span>
            </p>
          ) : b.type === 'code' ? (
            <pre key={i} className="overflow-x-auto rounded-md bg-surface-2 p-2 text-xs">
              {b.text}
            </pre>
          ) : (
            <p key={i} className={cn('whitespace-pre-wrap', b.type === 'quote' && 'border-l-2 border-hairline pl-3')}>
              {b.text}
            </p>
          ),
        )}
      </CardContent>
    </Card>
  );
}

/** Every field, one save away — folded, because most visits only read. */
function Details({ job }: { job: Job }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateJobAction.bind(null, job.id), null);
  return (
    <details className="group skin-card border border-hairline bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3.5 hover:bg-surface-2/50 sm:px-5 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-sm font-semibold tracking-tight">Edit details</span>
          <span className="block text-xs text-ink-muted">Every field here is a column in your Notion.</span>
        </span>
        <ArrowRight className="size-4 text-ink-muted transition-transform group-open:rotate-90" aria-hidden />
      </summary>
      <form action={action} className="space-y-3 border-t border-hairline px-4 pt-4 pb-4 sm:px-5 sm:pb-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField name="role" label="Role" defaultValue={job.role} required />
          <TextField name="company" label="Company" defaultValue={job.company} required />
          <TextField name="location" label="Location" defaultValue={job.location} />
          <SelectField name="work_mode" label="Work mode" options={WORK_MODES} defaultValue={job.workMode} />
          <SelectField name="source" label="Source" options={JOB_SOURCES} defaultValue={job.source} />
          <TextField name="salary" label="Salary" defaultValue={job.salary} />
          <TextField name="experience" label="Experience" defaultValue={job.experience} />
          <SelectField name="applied_via" label="Applied via" options={APPLIED_VIA} defaultValue={job.appliedVia} />
          <TextField name="applied_on" label="Applied on" type="date" defaultValue={job.appliedOn} />
          <TextField name="referral" label="Referral" defaultValue={job.referral} placeholder="Who referred you" />
          <TextField name="contact" label="Contact" defaultValue={job.contact} placeholder="Recruiter name, email" />
          <TextField name="resume_used" label="Resume used" defaultValue={job.resume} placeholder="e.g. v3-backend" />
          <TextField name="follow_up_on" label="Follow up on" type="date" defaultValue={job.followUpOn} />
          <TextField name="next_step" label="Next step" defaultValue={job.nextStep} className="sm:col-span-2" />
          <TextField name="job_url" label="Posting link" type="url" defaultValue={job.jobUrl} />
          <TextField name="apply_url" label="Apply link" type="url" defaultValue={job.applyUrl} />
          <TextField name="skills" label="Skills" defaultValue={job.skills.join(', ')} hint="comma-separated" className="sm:col-span-2" />
        </div>
        <TextArea name="how_to_apply" label="How to apply" defaultValue={job.howToApply} rows={5} hint="one step per line, numbered" />
        <TextArea name="why_it_fits" label="Why it fits" defaultValue={job.fit} rows={2} />
        <TextArea name="notes" label="Notes" defaultValue={job.notes} rows={3} />
        <FormMessage state={state} />
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Save changes
        </Button>
      </form>
    </details>
  );
}

/**
 * Removing is two steps and says where the job goes: Notion's trash, where it
 * can be restored for 30 days. "Not for me" is usually the better answer, and
 * the copy says that too.
 */
function Remove({ id, role }: { id: string; role: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="px-1">
      {confirming ? (
        <div className="skin-card space-y-2 border border-hairline bg-surface-2 px-3 py-2.5">
          <p className="text-xs text-ink-2">
            Remove “{role}”? It moves to your Notion trash, where it can be restored for 30 days. If you decided not to
            apply, “Not for me” keeps the record instead.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await trashJobAction(id);
                  if (r && !r.ok) setMessage(r.message);
                })
              }
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              Yes, remove it
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </div>
          {message ? <p className="text-xs text-critical">{message}</p> : null}
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline">
          Remove from tracker
        </button>
      )}
    </div>
  );
}
