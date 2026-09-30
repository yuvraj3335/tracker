'use client';

import { useState, useTransition } from 'react';
import { Check, ChevronDown, CircleCheck, CircleDot, CircleMinus, ExternalLink, FileText, Loader2, Scale } from 'lucide-react';
import { setJobStatusAction } from '@/app/jobs/actions';
import type { EvaluationReport, Job, RequirementMatch } from '@/lib/jobs';
import type { DayKey } from '@/lib/date';
import { reportProblem } from '@/lib/undo';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { CopyText } from './copy-text';
import {
  Chip,
  HardStopChip,
  LegitimacyBadge,
  MatchBadge,
  RedFlagChip,
  ScoreBars,
  VERDICT_STYLE,
  ago,
  safeHref,
} from './job-ui';
import { cn } from '@/lib/utils';

/**
 * The verdict, first thing on the job page: what the rubric says, why, and the
 * one action that follows from it. The action is offered, never taken — the
 * verdict is advice and the stage is the user's to move.
 */
export function VerdictCard({ job, report, today }: { job: Job; report: EvaluationReport | null; today: DayKey }) {
  // "Is it worth applying?" only matters before applying.
  if (!job.verdict) return job.status === 'Found' || job.status === 'Shortlisted' ? <NotEvaluated job={job} /> : null;
  const { color, Icon, hint } = VERDICT_STYLE[job.verdict];
  const summary = report?.summary || job.fit.split('\n')[0] || '';
  const reportHref = safeHref(job.reportUrl);
  return (
    <Card className="overflow-hidden">
      <div className="h-1" style={{ background: color }} aria-hidden />
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-micro font-semibold tracking-wide text-ink-muted uppercase">Verdict</p>
            <p className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight text-ink">
              <Icon className="size-5 shrink-0" style={{ color }} aria-hidden />
              {job.verdict}
            </p>
            <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>
          </div>
          <MatchBadge match={job.match} className="px-2 py-1 text-xs" />
        </div>
        {summary ? <p className="mt-3 text-sm leading-relaxed text-ink-2">{summary}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {job.levelFit ? <Chip>{job.levelFit}</Chip> : null}
          <LegitimacyBadge legitimacy={job.legitimacy} showHigh />
          {job.roleFamily ? <Chip>{job.roleFamily}</Chip> : null}
          {job.hardStops.map((h) => (
            <HardStopChip key={h}>{h}</HardStopChip>
          ))}
          {job.redFlags.map((f) => (
            <RedFlagChip key={f}>{f}</RedFlagChip>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {job.scores ? (
          <div className="border-t border-hairline pt-4">
            <ScoreBars scores={job.scores} notes={report?.notes} />
          </div>
        ) : null}
        {job.skillGaps.length ? (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-hairline pt-3">
            <span className="mr-1 text-xs text-ink-muted">Gaps</span>
            {job.skillGaps.map((g) => (
              <Chip key={g}>{g}</Chip>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
          <p className="text-micro text-ink-muted">
            {job.evaluation === 'Full' ? 'Full evaluation' : 'Quick look from the listing'}
            {job.evaluatedOn ? ` · ${ago(job.evaluatedOn, today)}` : ''}
            {job.evaluation === 'Quick' ? ' · ask your AI tool for a full read before deciding' : ''}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <NextStep job={job} />
            {reportHref ? (
              <a href={reportHref} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink">
                <FileText className="size-3" aria-hidden /> Report in Notion <ExternalLink className="size-2.5" aria-hidden />
              </a>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** The step a verdict suggests for a job not yet decided on — one button, your call. */
function NextStep({ job }: { job: Job }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  if (job.status !== 'Found') return null;
  const step =
    job.verdict === 'Apply'
      ? { label: 'Shortlist it', to: 'Shortlisted' as const }
      : job.verdict === 'Skip'
        ? { label: 'Skip it', to: 'Skipped' as const }
        : null;
  if (!step) return null;
  if (done) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-ink-2" role="status">
        <Check className="size-3.5 text-good-text" aria-hidden /> {done}
      </span>
    );
  }
  return (
    <Button
      size="sm"
      variant={job.verdict === 'Apply' ? 'primary' : 'outline'}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await setJobStatusAction(job.id, step.to);
          if (!r?.ok) reportProblem(r?.message ?? 'That did not save.');
          else setDone(step.to === 'Shortlisted' ? 'Shortlisted' : 'Skipped');
        })
      }
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
      {step.label}
    </Button>
  );
}

function NotEvaluated({ job }: { job: Job }) {
  const prompt = `Evaluate the ${job.role}${job.company ? ` job at ${job.company}` : ' job'} in my tracker`;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Scale className="size-3.5 text-ink-muted" aria-hidden />
          Not evaluated yet
        </CardTitle>
        <CardDescription>
          Your AI tool reads the posting, scores it against your profile and saves the verdict here: apply, consider, research
          first or skip.
          {job.match !== null ? ` The ${job.match}% here came from the tool that found it, before the rubric.` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CopyText text={prompt} />
      </CardContent>
    </Card>
  );
}

const MATCH_STYLE: Record<RequirementMatch, { Icon: typeof CircleCheck; color: string; label: string }> = {
  Strong: { Icon: CircleCheck, color: 'var(--good)', label: 'Strong match' },
  Partial: { Icon: CircleDot, color: 'var(--warning)', label: 'Partial match' },
  Missing: { Icon: CircleMinus, color: 'var(--critical)', label: 'Missing' },
};

/**
 * The full evaluation's reasoning, as it is saved in Notion: each requirement
 * against the resume, how to pitch the level, pay, why the posting looks real
 * or not, what to change in the resume, and the posting itself.
 */
export function EvaluationReportCard({ report }: { report: EvaluationReport }) {
  const counts = {
    Strong: report.requirements.filter((r) => r.match === 'Strong').length,
    Partial: report.requirements.filter((r) => r.match === 'Partial').length,
    Missing: report.requirements.filter((r) => r.match === 'Missing').length,
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Full evaluation</CardTitle>
        {report.byline ? <CardDescription>{report.byline}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-5">
        {report.requirements.length ? (
          <Section title="Requirements" aside={`${counts.Strong} strong · ${counts.Partial} partial · ${counts.Missing} missing`}>
            <ul className="divide-y divide-[var(--border)] rounded-lg border border-hairline">
              {report.requirements.map((r, i) => {
                const m = MATCH_STYLE[r.match];
                return (
                  <li key={i} className="flex gap-2.5 px-3 py-2.5">
                    <m.Icon className="mt-0.5 size-3.5 shrink-0" style={{ color: m.color }} aria-label={m.label} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">
                        {r.requirement}
                        <span className="ml-1.5 align-middle text-micro font-medium text-ink-muted">{r.weight}</span>
                      </p>
                      {r.evidence ? (
                        <p className={cn('mt-0.5 text-xs leading-relaxed break-words', r.match === 'Missing' ? 'text-ink-muted' : 'text-ink-2')}>
                          {r.match === 'Missing' ? r.evidence : `“${r.evidence.replace(/^["“]|["”]$/g, '')}”`}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>
        ) : null}
        {report.levelStrategy ? (
          <Section title="Level and strategy">
            {report.levelStrategy.split(/\n\s*\n/).map((p, i) => (
              <p key={i} className="text-sm leading-relaxed text-ink-2">
                {p}
              </p>
            ))}
          </Section>
        ) : null}
        <List title="Pay" items={report.payNotes} />
        <List title="Is it a real, open job?" items={report.legitimacySignals} />
        <List title="Resume edits for this posting" items={report.resumeEdits} numbered />
        {report.keywords.length ? (
          <Section title="Keywords an ATS will look for">
            <div className="flex flex-wrap gap-1">
              {report.keywords.map((k) => (
                <Chip key={k}>{k}</Chip>
              ))}
            </div>
          </Section>
        ) : null}
        {report.posting ? (
          <details className="group rounded-lg border border-hairline">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-xs font-medium text-ink-2 hover:bg-surface-2/50 [&::-webkit-details-marker]:hidden">
              The posting, as saved on the day
              <ChevronDown className="size-3.5 text-ink-muted transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="space-y-2 border-t border-hairline px-3 py-3 text-xs leading-relaxed whitespace-pre-wrap text-ink-2">
              {report.posting}
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Section({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">{title}</h3>
        {aside ? <span className="text-micro text-ink-muted tnum">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

function List({ title, items, numbered = false }: { title: string; items: string[]; numbered?: boolean }) {
  if (!items.length) return null;
  const Tag = numbered ? 'ol' : 'ul';
  return (
    <Section title={title}>
      <Tag className={cn('space-y-1 pl-5 text-sm leading-relaxed text-ink-2', numbered ? 'list-decimal' : 'list-disc')}>
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </Tag>
    </Section>
  );
}
