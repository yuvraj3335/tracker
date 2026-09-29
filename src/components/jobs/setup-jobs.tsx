'use client';

import { useActionState } from 'react';
import { Briefcase, Loader2 } from 'lucide-react';
import { setupJobsAction, type ActionState } from '@/app/jobs/actions';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { FormMessage } from './job-ui';

/**
 * The one step job tracking needs: two databases in the page the tracker was
 * built in. A button rather than something that happens on first visit,
 * because it writes to the person's Notion, and that should be their call.
 */
export function SetupJobs() {
  const [state, action, pending] = useActionState<ActionState, FormData>(async () => setupJobsAction(), null);
  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2">
            <Briefcase className="size-4 text-ink-muted" aria-hidden />
          </span>
          <div className="min-w-0 space-y-1">
            <h2 className="text-sm font-semibold">Track your job applications here</h2>
            <p className="text-xs text-ink-muted">
              This adds two things to the Notion page your tracker lives in: a <strong>Job Applications</strong>{' '}
              database (every job, its stage, dates and timeline) and a <strong>Job Profile</strong> (your target
              roles, preferences and resume). Your AI tools find jobs and write into the same place.
            </p>
          </div>
        </div>
        <form action={action}>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {pending ? 'Setting up…' : 'Set up job tracking'}
          </Button>
        </form>
        <FormMessage state={state} />
      </CardContent>
    </Card>
  );
}
