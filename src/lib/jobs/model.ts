/**
 * Job applications: the model — what a job is, which statuses mean what, and
 * what a move stamps. No I/O.
 *
 * Everything that decides what a job *means* lives in this folder, so the
 * tracker's own screens and every AI tool talking to it through the API follow
 * exactly the same rules. You move one thing — the status, or a timeline event —
 * and the dates are derived from it. Nobody fills in "Applied On" by hand.
 *
 *   model.ts       types, statuses, stamps, timeline events
 *   pipeline.ts    follow-ups, the pipeline summary, search, profile completeness
 *   dedupe.ts      when two postings are the same posting, and reposts
 *   input.ts       accepting loose input from forms and AI tools
 *   evaluation.ts  the rubric: scores → match → verdict, and evaluation input
 *   report.ts      the evaluation report as Notion blocks, and back
 *   notion.ts      reading and writing the user's Notion (server only)
 *   setup.ts       adding job tracking to an account, and migrating it (server only)
 */
import type {
  AddedBy,
  AppliedVia,
  EvalDepth,
  HardStop,
  JobSource,
  JobStatus,
  Legitimacy,
  LevelFit,
  PostingState,
  RedFlag,
  RoleFamily,
  Verdict,
  WorkMode,
} from '../schema';
import { isDayKey, type DayKey } from '../date';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Everything a person or an AI tool can set on a job. */
export type JobFields = {
  role: string;
  company: string;
  status: JobStatus;
  source: JobSource | null;
  location: string;
  workMode: WorkMode | null;
  jobUrl: string | null;
  applyUrl: string | null;
  fit: string;
  howToApply: string;
  salary: string;
  experience: string;
  skills: string[];
  postedOn: DayKey | null;
  appliedOn: DayKey | null;
  appliedVia: AppliedVia | null;
  resume: string;
  referral: string;
  contact: string;
  nextStep: string;
  followUpOn: DayKey | null;
  notes: string;
};

/** The five things a job is scored on, 1–5 each. Pay is null when the posting does not say. */
export type DimensionId = 'skills' | 'level' | 'location' | 'pay' | 'role';
export type DimensionScores = Record<DimensionId, number | null>;

/**
 * What an evaluation made of a job. Only an evaluation writes these — never a
 * form, never update_job — so every AI tool's verdict comes out of the same
 * rubric (lib/jobs/evaluation.ts) instead of each tool's own taste.
 */
export type JobJudgment = {
  /** 0–100 from the rubric. Rows saved before the rubric may carry a tool's own number. */
  match: number | null;
  verdict: Verdict | null;
  levelFit: LevelFit | null;
  legitimacy: Legitimacy | null;
  hardStops: HardStop[];
  redFlags: RedFlag[];
  roleFamily: RoleFamily | null;
  skillGaps: string[];
  scores: DimensionScores | null;
  evaluation: EvalDepth | null;
  evaluatedOn: DayKey | null;
  /** The full evaluation's own Notion page, a child of the job's page. */
  reportUrl: string | null;
  /** Whether the posting was still up when last checked, and when that was. */
  posting: PostingState | null;
  checkedOn: DayKey | null;
};

export const NO_JUDGMENT: JobJudgment = {
  match: null,
  verdict: null,
  levelFit: null,
  legitimacy: null,
  hardStops: [],
  redFlags: [],
  roleFamily: null,
  skillGaps: [],
  scores: null,
  evaluation: null,
  evaluatedOn: null,
  reportUrl: null,
  posting: null,
  checkedOn: null,
};

/** A job as read back, including the fields only the system writes. */
export type Job = JobFields & JobJudgment & {
  id: string;
  foundOn: DayKey | null;
  lastUpdate: DayKey | null;
  heardBackOn: DayKey | null;
  addedBy: AddedBy | null;
  key: string;
  notionUrl: string;
  createdAt: string;
};

/** A job being created. The description goes into the page body. */
export type NewJob = JobFields & { description: string };

/** Only the keys present are written; everything else is left alone. */
export type JobPatch = Partial<JobFields>;

export type JobProfile = {
  targetRoles: string;
  experience: string;
  locations: string;
  workModes: WorkMode[];
  skills: string;
  /** What you are aiming for. */
  salary: string;
  /** The least you would take: a posting below it is a hard stop. */
  minSalary: string;
  noticePeriod: string;
  /** Willing to move for the right job, so another city is not a hard stop. */
  relocation: boolean;
  mustHaves: string;
  dealBreakers: string;
  targetCompanies: string;
  avoidCompanies: string;
  resume: string;
};

export const EMPTY_PROFILE: JobProfile = {
  targetRoles: '',
  experience: '',
  locations: '',
  workModes: [],
  skills: '',
  salary: '',
  minSalary: '',
  noticePeriod: '',
  relocation: false,
  mustHaves: '',
  dealBreakers: '',
  targetCompanies: '',
  avoidCompanies: '',
  resume: '',
};

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Notion caps one text run at 2,000 characters and a URL at 2,000. Long fields
 * are split into runs on write (see `textRuns`), so the caps below are about
 * keeping a row readable rather than about what Notion would accept.
 */
export const LIMITS = {
  name: 200,
  location: 200,
  short: 200,
  medium: 600,
  long: 4000,
  url: 2000,
  skill: 50,
  skills: 15,
  description: 12000,
  resume: 40000,
  /** Jobs per add call. Each is one Notion write at ~3 a second. */
  batch: 20,
} as const;

// ---------------------------------------------------------------------------
// Status semantics
// ---------------------------------------------------------------------------

const APPLIED_STATUSES: ReadonlySet<JobStatus> = new Set([
  'Applied',
  'Assessment',
  'Interviewing',
  'Offer',
  'Rejected',
  'Ghosted',
  'Withdrawn',
]);

/** A reply of some kind — the company said something back. */
const RESPONSE_STATUSES: ReadonlySet<JobStatus> = new Set([
  'Assessment',
  'Interviewing',
  'Offer',
  'Rejected',
]);

const CLOSED_STATUSES: ReadonlySet<JobStatus> = new Set([
  'Rejected',
  'Ghosted',
  'Withdrawn',
  'Skipped',
]);

export const hasApplied = (s: JobStatus) => APPLIED_STATUSES.has(s);
export const isResponse = (s: JobStatus) => RESPONSE_STATUSES.has(s);
export const isClosed = (s: JobStatus) => CLOSED_STATUSES.has(s);

/** How far along an open application is. Closed statuses have no rank. */
const RANK: Partial<Record<JobStatus, number>> = {
  Found: 0,
  Shortlisted: 1,
  Applied: 2,
  Assessment: 3,
  Interviewing: 4,
  Offer: 5,
};

/** The board's groups, in pipeline order. Every status is in exactly one. */
export const JOB_GROUPS: readonly { id: string; label: string; hint: string; statuses: readonly JobStatus[] }[] = [
  { id: 'review', label: 'To review', hint: 'Found for you, not triaged yet', statuses: ['Found'] },
  { id: 'apply', label: 'To apply', hint: 'Worth applying to', statuses: ['Shortlisted'] },
  { id: 'applied', label: 'Applied', hint: 'Waiting to hear back', statuses: ['Applied'] },
  { id: 'process', label: 'In process', hint: 'Assessments and interviews', statuses: ['Assessment', 'Interviewing'] },
  { id: 'offer', label: 'Offers', hint: '', statuses: ['Offer'] },
  { id: 'closed', label: 'Closed', hint: 'Rejected, ghosted, withdrawn or skipped', statuses: ['Rejected', 'Ghosted', 'Withdrawn', 'Skipped'] },
];

/**
 * What moving to `next` stamps, given what is already stamped.
 *
 * Stamps are set once and never cleared: moving an application back to
 * "Shortlisted" by mistake must not erase the day it was actually sent.
 */
export function stampsFor(
  current: { appliedOn: DayKey | null; heardBackOn: DayKey | null },
  next: JobStatus,
  day: DayKey,
): { appliedOn?: DayKey; heardBackOn?: DayKey } {
  const out: { appliedOn?: DayKey; heardBackOn?: DayKey } = {};
  if (hasApplied(next) && !current.appliedOn) out.appliedOn = day;
  if (isResponse(next) && !current.heardBackOn) out.heardBackOn = day;
  return out;
}

// ---------------------------------------------------------------------------
// Timeline events
// ---------------------------------------------------------------------------

export const EVENT_KINDS = [
  'note',
  'applied',
  'followup',
  'reply',
  'call',
  'assessment',
  'interview',
  'rejection',
  'offer',
  'found',
  'status',
  'evaluated',
] as const;
export type JobEventKind = (typeof EVENT_KINDS)[number];

/** The kinds a person logs. `found`, `status` and `evaluated` are written by the system. */
export const LOGGABLE_KINDS = EVENT_KINDS.filter(
  (k) => k !== 'found' && k !== 'status' && k !== 'evaluated',
) as readonly JobEventKind[];

export const EVENT_LABEL: Record<JobEventKind, string> = {
  note: 'Note',
  applied: 'Applied',
  followup: 'Followed up',
  reply: 'They replied',
  call: 'Call',
  assessment: 'Assessment',
  interview: 'Interview',
  rejection: 'Rejected',
  offer: 'Offer',
  found: 'Found',
  status: 'Status',
  evaluated: 'Evaluated',
};

/** Logging one of these moves the application along with it. */
export const EVENT_MOVES_TO: Partial<Record<JobEventKind, JobStatus>> = {
  applied: 'Applied',
  assessment: 'Assessment',
  interview: 'Interviewing',
  rejection: 'Rejected',
  offer: 'Offer',
};

/** Any of these means the company answered. */
const HEARD_BACK_KINDS: ReadonlySet<JobEventKind> = new Set([
  'reply',
  'call',
  'assessment',
  'interview',
  'rejection',
  'offer',
]);

export const isHeardBack = (k: JobEventKind) => HEARD_BACK_KINDS.has(k);

/**
 * The status an event should leave the job in, or null to leave it alone.
 *
 * Never moves an open application backwards: logging "applied" on something
 * already interviewing is a note about history, not a demotion. Closing (a
 * rejection) always applies, and so does reopening a closed one.
 */
export function statusAfterEvent(current: JobStatus, kind: JobEventKind): JobStatus | null {
  const target = EVENT_MOVES_TO[kind];
  if (!target || target === current) return null;
  if (isClosed(target) || isClosed(current)) return target;
  const from = RANK[current] ?? -1;
  const to = RANK[target] ?? -1;
  return to > from ? target : null;
}

export type JobEvent = { date: DayKey; kind: JobEventKind; text: string };

const SEP = ' · ';
const DASH = ' — ';

/** One timeline line, as it is written into the Notion page. */
export function formatEvent(e: JobEvent): string {
  const label = EVENT_LABEL[e.kind];
  const text = e.text.replace(/\s+/g, ' ').trim();
  return `${e.date}${SEP}${label}${text ? DASH + text : ''}`;
}

const LABEL_TO_KIND = new Map(
  (Object.entries(EVENT_LABEL) as [JobEventKind, string][]).map(([k, v]) => [v.toLowerCase(), k]),
);

/**
 * Reads a timeline line back. A line somebody typed by hand in Notion that does
 * not follow the format is kept as a note rather than dropped: it is still
 * part of the story, just not one the app wrote.
 */
export function parseEvent(line: string): JobEvent | null {
  const s = line.trim();
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})\s*·\s*([\s\S]*)$/.exec(s);
  if (!m || !isDayKey(m[1])) return { date: '', kind: 'note', text: s };
  const rest = m[2];
  const dash = rest.indexOf('—');
  const head = (dash >= 0 ? rest.slice(0, dash) : rest).trim();
  const tail = dash >= 0 ? rest.slice(dash + 1).trim() : '';
  const kind = LABEL_TO_KIND.get(head.toLowerCase());
  if (!kind) return { date: m[1], kind: 'note', text: rest.trim() };
  return { date: m[1], kind, text: tail };
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/**
 * A lookup that only sees the table's own keys. A plain `table[input]` also
 * finds everything on Object.prototype, so "constructor" came back as the
 * Object function and passed every enum check.
 */
export function own<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/**
 * Splits text into Notion-sized runs. Notion caps a single text run at 2,000
 * characters but accepts up to 100 runs in one property, so a long resume is
 * stored whole rather than cut off.
 */
export function textRuns(s: string, size = 2000): string[] {
  if (!s) return [];
  const out: string[] = [];
  let i = 0;
  while (i < s.length && out.length < 100) {
    let end = Math.min(i + size, s.length);
    // Never between the two halves of an emoji: a lone surrogate is not text.
    const c = s.charCodeAt(end);
    if (end < s.length && c >= 0xdc00 && c <= 0xdfff) end--;
    out.push(s.slice(i, end));
    i = end;
  }
  return out;
}
