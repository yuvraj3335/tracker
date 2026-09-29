'use client';

import { useActionState } from 'react';
import { Loader2 } from 'lucide-react';
import { addJobAction, type ActionState } from '@/app/jobs/actions';
import { APPLIED_VIA, JOB_SOURCES, JOB_STATUS, WORK_MODES } from '@/lib/schema';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { FormMessage, SelectField, TextArea, TextField } from './job-ui';

/**
 * For a job you found yourself, or one a friend forwarded. It goes through the
 * same duplicate check as the AI tools' jobs, and lands on its own page.
 */
export function NewJobForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(addJobAction, null);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>The job</CardTitle>
            <CardDescription>Only the role and company are needed. Paste the link and the source fills itself in.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField name="role" label="Role" required placeholder="Software Engineer" />
              <TextField name="company" label="Company" required placeholder="Acme" />
            </div>
            <TextField name="job_url" label="Posting link" type="url" placeholder="https://…" />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField name="location" label="Location" placeholder="Bengaluru" />
              <SelectField name="work_mode" label="Work mode" options={WORK_MODES} />
              <TextField name="salary" label="Salary" placeholder="12–18 LPA" />
              <TextField name="experience" label="Experience" placeholder="0–2 years" />
              <SelectField name="source" label="Source" options={JOB_SOURCES} empty="From the link" className="sm:col-span-2" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Your application</CardTitle>
            <CardDescription>Already applied? Pick Applied — the date is stamped if you leave it empty.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField name="status" label="Stage" options={JOB_STATUS} defaultValue="Shortlisted" empty={null} />
              <SelectField name="applied_via" label="Applied via" options={APPLIED_VIA} />
              <TextField name="applied_on" label="Applied on" type="date" />
              <TextField name="follow_up_on" label="Follow up on" type="date" />
              <TextField name="referral" label="Referral" placeholder="Who referred you" className="sm:col-span-2" />
            </div>
            <TextArea name="notes" label="Notes" rows={4} placeholder="Anything worth remembering about this one" />
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-wrap items-center gap-3 px-1">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Add to tracker
        </Button>
        <div className="min-w-0 flex-1">
          <FormMessage state={state} />
        </div>
      </div>
    </form>
  );
}
