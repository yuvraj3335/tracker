'use client';

import { useActionState } from 'react';
import { FileText, Loader2, Target } from 'lucide-react';
import { saveProfileAction, type ActionState } from '@/app/jobs/actions';
import { profileCompleteness, type JobProfile } from '@/lib/jobs';
import { WORK_MODES } from '@/lib/schema';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { ProgressBar } from '../progress-bar';
import { FormMessage, TextArea, TextField } from './job-ui';

/**
 * What every search is tailored to. Stored in the Job Profile database in the
 * person's own Notion — never in the app's repository, which is public.
 */
export function ProfileForm({ profile }: { profile: JobProfile }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveProfileAction, null);
  const c = profileCompleteness(profile);
  const complete = c.filled === c.total;

  return (
    <form action={action} className="space-y-4">
      <Card>
        <CardContent className="space-y-2.5 pt-4 sm:pt-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold">{complete ? 'Your profile is complete' : 'Finish your profile for better matches'}</p>
            <p className="shrink-0 text-xs text-ink-muted tnum">
              {c.filled} of {c.total}
            </p>
          </div>
          <ProgressBar value={(c.filled / c.total) * 100} height={6} color={complete ? 'var(--good)' : 'var(--accent)'} label="Profile completeness" />
          {!complete ? <p className="text-xs text-ink-muted">Still missing: {c.missing.join(', ')}.</p> : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Target className="size-3.5 text-ink-muted" aria-hidden />
              What you are looking for
            </CardTitle>
            <CardDescription>Your AI tools read this before every search, and score every job against it: level, location, pay and the rest.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <TextArea name="target_roles" label="Target roles" defaultValue={profile.targetRoles} rows={2} placeholder="SDE-1, Software Engineer, Backend Engineer" />
            <TextArea name="locations" label="Locations" defaultValue={profile.locations} rows={2} placeholder="Bengaluru, Pune, Remote (India)" />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField name="experience" label="Experience" defaultValue={profile.experience} placeholder="1 year" />
              <TextField name="notice_period" label="Notice period" defaultValue={profile.noticePeriod} placeholder="30 days" />
              <TextField name="salary" label="Target salary" defaultValue={profile.salary} placeholder="15 LPA fixed" />
              <TextField name="min_salary" label="Minimum salary" defaultValue={profile.minSalary} placeholder="10 LPA" hint="below this is a hard stop" />
            </div>
            <fieldset>
              <legend className="mb-1.5 block text-xs font-medium text-ink-2">Work modes</legend>
              <div className="flex flex-wrap gap-2">
                {WORK_MODES.map((m) => (
                  <label
                    key={m}
                    className="skin-pill flex cursor-pointer items-center gap-1.5 border border-hairline bg-surface px-3 py-1.5 text-xs text-ink-2 transition-colors hover:bg-surface-2 has-[:checked]:border-transparent has-[:checked]:bg-accent has-[:checked]:text-accent-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent"
                  >
                    <input type="checkbox" name="work_modes" value={m} defaultChecked={profile.workModes.includes(m)} className="sr-only" />
                    {m}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex cursor-pointer items-start gap-2 text-xs text-ink-2">
              <input type="checkbox" name="open_to_relocation" defaultChecked={profile.relocation} className="mt-0.5 size-3.5 accent-[var(--accent)]" />
              <span>
                Open to relocating for the right job
                <span className="block text-micro text-ink-muted">Without this, an on-site job in another city is a hard stop.</span>
              </span>
            </label>
            <TextArea name="skills" label="Skills and stack" defaultValue={profile.skills} rows={2} placeholder="TypeScript, Node.js, React, Python, Postgres, AWS" />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextArea name="must_haves" label="Must-haves" defaultValue={profile.mustHaves} rows={2} placeholder="Product company, strong engineering culture" />
              <TextArea name="deal_breakers" label="Deal-breakers" defaultValue={profile.dealBreakers} rows={2} placeholder="Service firms, bond agreements" />
              <TextArea name="target_companies" label="Target companies" defaultValue={profile.targetCompanies} rows={2} placeholder="Razorpay, CRED, Postman" hint="their career sites are searched too" />
              <TextArea name="avoid_companies" label="Companies to skip" defaultValue={profile.avoidCompanies} rows={2} />
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <FileText className="size-3.5 text-ink-muted" aria-hidden />
              Resume
            </CardTitle>
            <CardDescription>Paste it as plain text. Used to score matches and to suggest what to lead with for each job.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col">
            <label htmlFor="resume" className="sr-only">
              Resume text
            </label>
            <textarea
              id="resume"
              name="resume"
              defaultValue={profile.resume}
              placeholder="Paste your resume here…"
              className="min-h-72 w-full flex-1 resize-y rounded-lg border border-hairline bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-ink outline-none placeholder:text-ink-muted/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
            <p className="mt-1.5 text-meta text-ink-muted tnum">{profile.resume ? `${profile.resume.length.toLocaleString('en-IN')} characters saved` : 'Nothing saved yet'}</p>
          </CardContent>
        </Card>
      </div>

      {/* Stays in reach on a long form, above the phone's bottom bar. */}
      <div className="sticky bottom-16 z-10 -mx-3 border-t border-hairline bg-plane/90 px-3 py-2.5 backdrop-blur-md sm:bottom-0 sm:-mx-4 sm:px-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save profile
          </Button>
          <div className="min-w-0 flex-1">
            <FormMessage state={state} />
          </div>
        </div>
      </div>
    </form>
  );
}
