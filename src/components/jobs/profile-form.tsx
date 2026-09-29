'use client';

import { useActionState } from 'react';
import { Loader2 } from 'lucide-react';
import { saveProfileAction, type ActionState } from '@/app/jobs/actions';
import type { JobProfile } from '@/lib/jobs';
import { WORK_MODES } from '@/lib/schema';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { FormMessage, TextArea, TextField } from './job-ui';

/**
 * What every search is tailored to. Stored in the Job Profile database in the
 * person's own Notion — never in the app's repository, which is public.
 */
export function ProfileForm({ profile }: { profile: JobProfile }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveProfileAction, null);
  return (
    <form action={action} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>What you are looking for</CardTitle>
          <CardDescription>Your AI tools read this before every search, and score each job against it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextArea name="target_roles" label="Target roles" defaultValue={profile.targetRoles} rows={2} placeholder="SDE-1, Software Engineer, Backend Engineer" />
            <TextArea name="locations" label="Locations" defaultValue={profile.locations} rows={2} placeholder="Bengaluru, Pune, Remote (India)" />
            <TextField name="experience" label="Experience" defaultValue={profile.experience} placeholder="1 year" />
            <TextField name="salary" label="Expected salary" defaultValue={profile.salary} placeholder="e.g. 12+ LPA" />
            <TextField name="notice_period" label="Notice period" defaultValue={profile.noticePeriod} placeholder="e.g. 30 days" />
            <fieldset>
              <legend className="mb-1 block text-xs font-medium text-ink-2">Work modes</legend>
              <div className="flex flex-wrap gap-3 pt-1.5">
                {WORK_MODES.map((m) => (
                  <label key={m} className="flex items-center gap-1.5 text-sm text-ink-2">
                    <input
                      type="checkbox"
                      name="work_modes"
                      value={m}
                      defaultChecked={profile.workModes.includes(m)}
                      className="size-3.5 accent-[var(--accent)]"
                    />
                    {m}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <TextArea name="skills" label="Skills and stack" defaultValue={profile.skills} rows={2} placeholder="TypeScript, Node.js, React, Python, Postgres, AWS" />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextArea name="must_haves" label="Must-haves" defaultValue={profile.mustHaves} rows={2} placeholder="Product company, strong engineering culture" />
            <TextArea name="deal_breakers" label="Deal-breakers" defaultValue={profile.dealBreakers} rows={2} placeholder="Service/outsourcing firms, bond agreements" />
            <TextArea name="target_companies" label="Target companies" defaultValue={profile.targetCompanies} rows={2} placeholder="Razorpay, CRED, Postman" hint="their career sites are searched too" />
            <TextArea name="avoid_companies" label="Companies to skip" defaultValue={profile.avoidCompanies} rows={2} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resume</CardTitle>
          <CardDescription>
            Paste it as plain text. It is used to match jobs and to suggest what to lead with for each one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TextArea name="resume" label="Resume text" defaultValue={profile.resume} rows={14} placeholder="Paste your resume here…" />
        </CardContent>
      </Card>

      <div className="space-y-2 px-1">
        <FormMessage state={state} />
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Save profile
        </Button>
      </div>
    </form>
  );
}
