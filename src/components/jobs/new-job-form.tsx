'use client';

import { useActionState } from 'react';
import { Loader2 } from 'lucide-react';
import { addJobAction, type ActionState } from '@/app/jobs/actions';
import { APPLIED_VIA, JOB_SOURCES, JOB_STATUS, WORK_MODES } from '@/lib/schema';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { FormMessage, SelectField, TextArea, TextField } from './job-ui';

/** For the job you found yourself — or one a friend forwarded. */
export function NewJobForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addJobAction, null);
  return (
    <Card>
      <CardContent className="pt-4 sm:pt-5">
        <form action={action} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField name="role" label="Role" required placeholder="Software Engineer" />
            <TextField name="company" label="Company" required placeholder="Acme" />
            <TextField name="job_url" label="Posting link" type="url" placeholder="https://…" className="sm:col-span-2" />
            <TextField name="location" label="Location" placeholder="Bengaluru" />
            <SelectField name="work_mode" label="Work mode" options={WORK_MODES} />
            <SelectField name="source" label="Source" options={JOB_SOURCES} />
            <SelectField name="status" label="Status" options={JOB_STATUS} defaultValue="Shortlisted" empty={null} />
            <SelectField name="applied_via" label="Applied via" options={APPLIED_VIA} />
            <TextField name="applied_on" label="Applied on" type="date" placeholder={today} />
            <TextField name="salary" label="Salary" placeholder="e.g. 12–18 LPA" />
            <TextField name="experience" label="Experience" placeholder="e.g. 0–2 years" />
            <TextField name="referral" label="Referral" placeholder="Who referred you" />
            <TextField name="follow_up_on" label="Follow up on" type="date" />
          </div>
          <TextArea name="notes" label="Notes" rows={3} />
          <p className="text-meta text-ink-muted">
            Already applied? Pick Applied — the date is stamped for you if you leave “Applied on” empty.
          </p>
          <FormMessage state={state} />
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Add to tracker
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
