/**
 * The pipeline, derived: follow-ups, the summary, search and how complete the
 * profile is. Nothing here is stored — it is all worked out from the jobs.
 */
import { JOB_STATUS, type JobStatus } from '../schema';
import { daysBetween, type DayKey } from '../date';
import { matchesTokens, normalize, tokenize } from '../search';
import { JOB_GROUPS, hasApplied, isClosed, isResponse, type Job, type JobProfile } from './model';

// ---------------------------------------------------------------------------
// Follow-ups and the pipeline summary
// ---------------------------------------------------------------------------

/** After this long with no answer, it is worth a nudge. */
export const NUDGE_AFTER_DAYS = 7;
/** After this long, it is probably not coming. */
export const STALE_AFTER_DAYS = 21;

export type FollowUp =
  /** A follow-up date was set and has arrived. */
  | { kind: 'due'; days: number }
  /** Applied a week or more ago, no answer, no follow-up planned. */
  | { kind: 'nudge'; days: number }
  /** Three weeks or more with no answer: probably ghosted. */
  | { kind: 'stale'; days: number };

export function followUpFor(
  job: Pick<Job, 'status' | 'followUpOn' | 'appliedOn' | 'heardBackOn'>,
  today: DayKey,
): FollowUp | null {
  if (isClosed(job.status)) return null;
  if (job.followUpOn && job.followUpOn <= today) {
    return { kind: 'due', days: daysBetween(job.followUpOn, today) };
  }
  if (job.status === 'Applied' && job.appliedOn && !job.heardBackOn) {
    const days = daysBetween(job.appliedOn, today);
    if (days >= STALE_AFTER_DAYS) return { kind: 'stale', days };
    if (days >= NUDGE_AFTER_DAYS && !job.followUpOn) return { kind: 'nudge', days };
  }
  return null;
}

export type PipelineSummary = {
  total: number;
  byStatus: Record<JobStatus, number>;
  byGroup: Record<string, number>;
  applied: number;
  heardBack: number;
  /** Share of sent applications that got any answer, 0–1. */
  responseRate: number;
  appliedLast7Days: number;
  followUps: { job: Job; followUp: FollowUp }[];
};

export function pipelineSummary(jobs: readonly Job[], today: DayKey): PipelineSummary {
  const byStatus = Object.fromEntries(JOB_STATUS.map((s) => [s, 0])) as Record<JobStatus, number>;
  let applied = 0;
  let heardBack = 0;
  let appliedLast7Days = 0;
  const followUps: { job: Job; followUp: FollowUp }[] = [];

  for (const j of jobs) {
    byStatus[j.status]++;
    if (hasApplied(j.status)) {
      applied++;
      if (j.heardBackOn || isResponse(j.status)) heardBack++;
      if (j.appliedOn && daysBetween(j.appliedOn, today) < 7) appliedLast7Days++;
    }
    const f = followUpFor(j, today);
    if (f) followUps.push({ job: j, followUp: f });
  }

  // Most urgent first: a date that has arrived, then the longest silences.
  const weight = (f: FollowUp) => (f.kind === 'due' ? 2 : f.kind === 'stale' ? 1 : 0);
  followUps.sort((a, b) => weight(b.followUp) - weight(a.followUp) || b.followUp.days - a.followUp.days);

  const byGroup = Object.fromEntries(
    JOB_GROUPS.map((g) => [g.id, g.statuses.reduce((n, s) => n + byStatus[s], 0)]),
  );

  return {
    total: jobs.length,
    byStatus,
    byGroup,
    applied,
    heardBack,
    responseRate: applied ? heardBack / applied : 0,
    appliedLast7Days,
    followUps,
  };
}

/** Token-AND search across the fields people actually remember. */
export function jobHaystack(j: Job): string {
  return normalize(
    [j.role, j.company, j.location, j.source ?? '', j.workMode ?? '', j.skills.join(' '), j.notes, j.status].join(' '),
  );
}

export function searchJobs(jobs: readonly Job[], query: string): Job[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [...jobs];
  return jobs.filter((j) => matchesTokens(jobHaystack(j), tokens));
}

/** True when there is enough in the profile to search with. */
export function profileIsUsable(p: JobProfile): boolean {
  return Boolean(p.targetRoles.trim() || p.resume.trim());
}

/** The profile fields a search leans on, in the order the form asks for them. */
const PROFILE_PARTS: { key: keyof JobProfile; label: string }[] = [
  { key: 'targetRoles', label: 'target roles' },
  { key: 'experience', label: 'experience' },
  { key: 'locations', label: 'locations' },
  { key: 'workModes', label: 'work modes' },
  { key: 'skills', label: 'skills' },
  { key: 'resume', label: 'resume' },
];

/** How much of the profile is filled in, and what is still missing, for the profile page. */
export function profileCompleteness(p: JobProfile): { filled: number; total: number; missing: string[] } {
  const missing = PROFILE_PARTS.filter(({ key }) => {
    const v = p[key];
    return Array.isArray(v) ? v.length === 0 : !String(v ?? '').trim();
  }).map((x) => x.label);
  return { filled: PROFILE_PARTS.length - missing.length, total: PROFILE_PARTS.length, missing };
}
