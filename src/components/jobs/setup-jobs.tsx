'use client';

import { useActionState } from 'react';
import { Briefcase, Columns3, Loader2, Sparkles, UserRound } from 'lucide-react';
import { setupJobsAction, type ActionState } from '@/app/jobs/actions';
import { Button } from '../ui/button';
import { FormMessage } from './job-ui';

const WHAT = [
  { icon: Columns3, title: 'A pipeline in your Notion', body: 'Every job, its stage, dates and timeline — a Job Applications database with board and follow-up views.' },
  { icon: UserRound, title: 'Your job profile', body: 'Target roles, preferences and resume, so every search is tailored to you.' },
  { icon: Sparkles, title: 'AI tools that fill it in', body: 'Claude Code, Codex, Gemini or Claude Desktop search the job boards and save the good ones here.' },
];

/**
 * The one step job tracking needs. A button rather than something that happens
 * on first visit, because it writes to the person's Notion — their call.
 */
export function SetupJobs() {
  const [state, action, pending] = useActionState<ActionState, FormData>(async () => setupJobsAction(), null);
  return (
    <section className="skin-card relative overflow-hidden border border-hairline bg-surface shadow-lift-1">
      <span aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ background: 'radial-gradient(90% 120% at 100% 0%, var(--accent) 0%, transparent 60%)' }} />
      <div className="relative space-y-5 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2">
            <Briefcase className="size-4.5 text-accent" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">Run your job search from here</h2>
            <p className="mt-1 text-xs text-ink-muted">One click adds job tracking to the Notion page your tracker already lives in.</p>
          </div>
        </div>
        <ul className="grid gap-3 sm:grid-cols-3">
          {WHAT.map((w) => (
            <li key={w.title} className="skin-card border border-hairline bg-surface p-3">
              <w.icon className="size-4 text-ink-muted" aria-hidden />
              <p className="mt-2 text-xs font-semibold text-ink">{w.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{w.body}</p>
            </li>
          ))}
        </ul>
        <form action={action} className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {pending ? 'Setting up…' : 'Set up job tracking'}
          </Button>
          <span className="text-micro text-ink-muted">Takes a few seconds. Nothing already in your Notion is changed.</span>
        </form>
        <FormMessage state={state} />
      </div>
    </section>
  );
}
