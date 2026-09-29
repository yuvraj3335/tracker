'use client';

import { useActionState, useOptimistic, useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, Loader2, Trash2 } from 'lucide-react';
import {
  logJobEventAction,
  setJobStatusAction,
  trashJobAction,
  updateJobAction,
  type ActionState,
} from '@/app/jobs/actions';
import { EVENT_LABEL, LOGGABLE_KINDS, followUpFor, type Job, type JobEvent } from '@/lib/jobs';
import type { BodyBlock } from '@/lib/jobs-notion';
import { APPLIED_VIA, JOB_SOURCES, JOB_STATUS, WORK_MODES, type JobStatus } from '@/lib/schema';
import { formatKey, type DayKey } from '@/lib/date';
import { reportProblem } from '@/lib/undo';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import {
  FollowUpBadge,
  FormMessage,
  Label,
  MatchBadge,
  SelectField,
  StatusDot,
  TextArea,
  TextField,
  ago,
  inputClass,
  safeHref,
} from './job-ui';
import { cn } from '@/lib/utils';

export function JobDetail({
  job,
  description,
  timeline,
  today,
}: {
  job: Job;
  description: BodyBlock[];
  timeline: JobEvent[];
  today: DayKey;
}) {
  const [status, setStatus] = useOptimistic(job.status);
  const [moving, startMove] = useTransition();
  const followUp = followUpFor({ ...job, status }, today);

  function move(next: JobStatus) {
    startMove(async () => {
      setStatus(next);
      const r = await setJobStatusAction(job.id, next);
      if (!r?.ok) reportProblem(r?.message ?? 'Could not change the status.');
    });
  }

  const links = [
    { label: 'Posting', href: safeHref(job.jobUrl) },
    { label: 'Apply', href: safeHref(job.applyUrl) },
    { label: 'Open in Notion', href: safeHref(job.notionUrl) },
  ].filter((l): l is { label: string; href: string } => Boolean(l.href));

  return (
    <div className="space-y-4">
      <Link href="/jobs" className="inline-flex items-center gap-1 px-1 text-xs font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> All jobs
      </Link>

      {/* ---- header ---- */}
      <Card>
        <CardContent className="space-y-3 pt-4 sm:pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-display font-semibold">{job.role}</h1>
              <p className="mt-1 text-sm text-ink-2">
                {job.company}
                {job.location ? <span className="text-ink-muted"> · {job.location}</span> : null}
                {job.workMode ? <span className="text-ink-muted"> · {job.workMode}</span> : null}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-meta text-ink-muted">
                <MatchBadge match={job.match} />
                {job.source ? <span>{job.source}</span> : null}
                {job.postedOn ? <span className="tnum">posted {ago(job.postedOn, today)}</span> : null}
                {job.appliedOn ? <span className="tnum">applied {formatKey(job.appliedOn, 'd MMM')}</span> : null}
                {job.heardBackOn ? <span className="tnum">heard back {formatKey(job.heardBackOn, 'd MMM')}</span> : null}
                <FollowUpBadge followUp={followUp} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusDot status={status} />
              <select
                value={status}
                onChange={(e) => move(e.target.value as JobStatus)}
                disabled={moving}
                aria-label="Status"
                className="skin-pill cursor-pointer border border-hairline bg-surface px-3 py-1.5 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-accent"
              >
                {JOB_STATUS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {moving ? <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-label="Saving" /> : null}
            </div>
          </div>
          {links.length ? (
            <div className="flex flex-wrap gap-2">
              {links.map((l) => (
                <Button key={l.label} asChild variant={l.label === 'Apply' ? 'primary' : 'outline'} size="sm">
                  <a href={l.href} target="_blank" rel="noreferrer noopener">
                    {l.label}
                    <ExternalLink className="size-3" />
                  </a>
                </Button>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {job.howToApply || job.fit ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {job.howToApply ? (
            <Card className={cn(!job.fit && 'sm:col-span-2')}>
              <CardHeader>
                <CardTitle>How to apply</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-2">{job.howToApply}</p>
              </CardContent>
            </Card>
          ) : null}
          {job.fit ? (
            <Card className={cn(!job.howToApply && 'sm:col-span-2')}>
              <CardHeader>
                <CardTitle>Why it fits</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-2">{job.fit}</p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      <Timeline id={job.id} timeline={timeline} today={today} />
      <Details job={job} />

      {description.length ? (
        <Card>
          <CardHeader>
            <CardTitle>About the role</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm leading-relaxed text-ink-2">
            {description.map((b, i) =>
              b.type === 'heading' ? (
                <h3 key={i} className="pt-1 text-sm font-semibold text-ink">
                  {b.text}
                </h3>
              ) : b.type === 'bullet' || b.type === 'todo' ? (
                <p key={i} className="pl-3">
                  • {b.text}
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
      ) : null}

      <Remove id={job.id} role={job.role} />
    </div>
  );
}

function Timeline({ id, timeline, today }: { id: string; timeline: JobEvent[]; today: DayKey }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(logJobEventAction.bind(null, id), null);
  const events = [...timeline].reverse();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
        <CardDescription>
          Log what happened — a reply, an interview, a rejection. Events that imply a new stage move the status for you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={action} className="grid gap-2.5 sm:grid-cols-[10rem_1fr_9rem_auto] sm:items-end">
          <div>
            <Label htmlFor="kind">What happened</Label>
            <select id="kind" name="kind" defaultValue="reply" className={cn(inputClass, 'cursor-pointer')}>
              {LOGGABLE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {EVENT_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <TextField name="text" label="Details" placeholder="e.g. Recruiter emailed an OA link, due Friday" />
          <TextField name="date" label="When" type="date" defaultValue={today} />
          <Button type="submit" disabled={pending} className="sm:mb-px">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Log it
          </Button>
          <label className="flex items-center gap-2 text-xs text-ink-2 sm:col-span-4">
            <input type="checkbox" name="move_status" defaultChecked className="size-3.5 accent-[var(--accent)]" />
            Move the status to match (an interview moves it to Interviewing)
          </label>
        </form>
        <FormMessage state={state} />
        {events.length ? (
          <ol className="relative space-y-3 border-l border-hairline pl-4">
            {events.map((e, i) => (
              <li key={i} className="relative">
                <span className="absolute top-1.5 -left-[1.28rem] size-2 rounded-full border border-hairline bg-surface" aria-hidden />
                <p className="text-xs">
                  <span className="font-semibold text-ink">{EVENT_LABEL[e.kind]}</span>
                  {e.date ? <span className="ml-1.5 text-ink-muted tnum">{formatKey(e.date, 'd MMM yyyy')}</span> : null}
                </p>
                {e.text ? <p className="mt-0.5 text-sm text-ink-2">{e.text}</p> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-ink-muted">Nothing logged yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function Details({ job }: { job: Job }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateJobAction.bind(null, job.id), null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
        <CardDescription>Everything here is a column in your Notion. Change what you like and save.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField name="role" label="Role" defaultValue={job.role} required />
            <TextField name="company" label="Company" defaultValue={job.company} required />
            <TextField name="location" label="Location" defaultValue={job.location} />
            <SelectField name="work_mode" label="Work mode" options={WORK_MODES} defaultValue={job.workMode} />
            <SelectField name="source" label="Source" options={JOB_SOURCES} defaultValue={job.source} />
            <TextField name="match" label="Match" type="number" defaultValue={job.match} hint="0–100" />
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
          <TextArea name="how_to_apply" label="How to apply" defaultValue={job.howToApply} rows={4} />
          <TextArea name="why_it_fits" label="Why it fits" defaultValue={job.fit} rows={2} />
          <TextArea name="notes" label="Notes" defaultValue={job.notes} rows={3} />
          <FormMessage state={state} />
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save changes
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Removing is two steps and says where the job goes: Notion's trash, where it
 * can be restored for 30 days. Skipped is usually the better answer, and the
 * copy says that too.
 */
function Remove({ id, role }: { id: string; role: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="px-1 pb-2">
      {confirming ? (
        <div className="skin-card space-y-2 border border-hairline bg-surface-2 px-3 py-2.5">
          <p className="text-xs text-ink-2">
            Remove “{role}”? It moves to your Notion trash, where you can restore it for 30 days. If you just decided
            not to apply, setting the status to Skipped keeps the record instead.
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
