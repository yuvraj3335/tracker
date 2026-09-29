/**
 * Job applications: the domain rules, with no I/O.
 *
 * Everything that decides what a job *means* lives here — which statuses count
 * as having applied, what gets stamped when a status moves, when a posting is
 * the same posting seen twice, and what input is acceptable — so the tracker's
 * own screens and every AI tool talking to it through the API follow exactly
 * the same rules. Both paths write through `jobs-notion.ts`, and both validate
 * with the parsers below.
 *
 * Same principle as the rest of the app: you move one thing (the status, or a
 * timeline event) and the dates are derived from it. Nobody fills in "Applied
 * On" by hand.
 */
import {
  APPLIED_VIA,
  JOB_SOURCES,
  JOB_STATUS,
  WORK_MODES,
  type AddedBy,
  type AppliedVia,
  type JobSource,
  type JobStatus,
  type WorkMode,
} from './schema';
import { daysBetween, isDayKey, type DayKey } from './date';
import { matchesTokens, normalize, tokenize } from './search';

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
  /** 0–100, how well the posting fits the profile. */
  match: number | null;
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

/** A job as read back, including the fields only the system writes. */
export type Job = JobFields & {
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
  salary: string;
  noticePeriod: string;
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
  noticePeriod: '',
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
] as const;
export type JobEventKind = (typeof EVENT_KINDS)[number];

/** The kinds a person logs. `found` and `status` are written by the system. */
export const LOGGABLE_KINDS = EVENT_KINDS.filter(
  (k) => k !== 'found' && k !== 'status',
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

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

/**
 * A stable identity for a posting, so the same job found twice — by two
 * searches, or by two AI tools — is recognised as one.
 *
 * The job boards all carry their own posting id somewhere in the URL, and that
 * id survives everything that changes between two copies of the same link:
 * tracking parameters, country subdomains (in.linkedin.com), the slug, an
 * `/apply` suffix. So the id is extracted where the board is known, and the
 * cleaned URL is the fallback.
 */
export function postingKey(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = decodeSafe(u.pathname).replace(/\/+$/, '');
  const q = (k: string) => u.searchParams.get(k);

  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
    const id = /\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/.exec(path)?.[1] ?? q('currentJobId');
    if (id) return `linkedin:${id}`;
  }
  if (host.endsWith('naukri.com')) {
    const id = /-(\d{9,})(?:$|[/?])/.exec(path + '/')?.[1];
    if (id) return `naukri:${id}`;
  }
  if (host.includes('glassdoor.')) {
    const id = q('jl') ?? q('jobListingId') ?? /_JV_.*?KO\d+,\d+_KE\d+,\d+\.htm/.exec(path)?.[0] ?? null;
    if (id) return `glassdoor:${id}`;
  }
  if (host.endsWith('myworkdayjobs.com') || host.endsWith('myworkdaysite.com')) {
    const tenant = host.split('.')[0];
    const req = /_([A-Za-z0-9-]*\d[A-Za-z0-9-]*)(?:\/apply)?$/.exec(path)?.[1];
    if (req) return `workday:${tenant}:${req.toLowerCase()}`;
  }
  if (host.endsWith('greenhouse.io')) {
    const m = /\/([^/]+)\/jobs\/(\d+)/.exec(path);
    const id = m?.[2] ?? q('gh_jid');
    if (id) return `greenhouse:${id}`;
  }
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') {
    const m = /^\/([^/]+)\/([0-9a-f-]{36})/.exec(path);
    if (m) return `lever:${m[2]}`;
  }
  if (host === 'jobs.ashbyhq.com') {
    const m = /^\/([^/]+)\/([0-9a-f-]{36})/.exec(path);
    if (m) return `ashby:${m[2]}`;
  }
  if (host === 'wellfound.com' || host === 'angel.co') {
    const id = /\/jobs\/(\d+)/.exec(path)?.[1];
    if (id) return `wellfound:${id}`;
  }
  if (host.endsWith('instahyre.com')) {
    const id = /\/job-(\d+)/.exec(path)?.[1];
    if (id) return `instahyre:${id}`;
  }
  if (host.endsWith('foundit.in') || host.endsWith('monsterindia.com')) {
    const id = /-(\d{5,})(?:$|[/?])/.exec(path + '/')?.[1] ?? q('jobId');
    if (id) return `foundit:${id}`;
  }
  if (host.endsWith('cutshort.io')) {
    const id = /\/job\/[^/]*?-([A-Za-z0-9]{6,})$/.exec(path)?.[1];
    if (id) return `cutshort:${id}`;
  }
  return `url:${host}${path.toLowerCase()}`;
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const COMPANY_NOISE = /\b(private|pvt|limited|ltd|inc|llc|llp|corp|corporation|co|company|technologies|technology|solutions|india|services|group)\b/g;

/** The same role at the same company in the same place, seen on another board. */
export function signature(j: Pick<JobFields, 'company' | 'role' | 'location'>): string {
  const company = normalize(j.company).replace(COMPANY_NOISE, ' ').replace(/\s+/g, ' ').trim();
  const role = normalize(j.role);
  const city = normalize(j.location).split(' ')[0] ?? '';
  return `sig:${company}|${role}|${city}`;
}

/** The key stored on the row. The posting id when there is one. */
export function dedupeKey(j: Pick<JobFields, 'jobUrl' | 'applyUrl' | 'company' | 'role' | 'location'>): string {
  return postingKey(j.jobUrl) ?? postingKey(j.applyUrl) ?? signature(j);
}

export type DuplicateHit = { id: string; reason: 'same posting' | 'same role, company and city' };

/**
 * Finds an existing job this one duplicates.
 *
 * Two tests, strongest first: the same posting (by board id or URL), then the
 * same role at the same company in the same city. The second catches one job
 * cross-posted on LinkedIn and Naukri, which have different ids for it.
 */
export function findDuplicate(
  candidate: Pick<JobFields, 'jobUrl' | 'applyUrl' | 'company' | 'role' | 'location'>,
  existing: readonly Pick<Job, 'id' | 'key' | 'jobUrl' | 'applyUrl' | 'company' | 'role' | 'location'>[],
): DuplicateHit | null {
  const keys = new Set(
    [postingKey(candidate.jobUrl), postingKey(candidate.applyUrl)].filter((k): k is string => Boolean(k)),
  );
  const sig = signature(candidate);
  for (const e of existing) {
    const theirs = [e.key, postingKey(e.jobUrl), postingKey(e.applyUrl)];
    if (theirs.some((k) => k && keys.has(k))) return { id: e.id, reason: 'same posting' };
  }
  if (!candidate.company.trim() || !candidate.role.trim()) return null;
  for (const e of existing) {
    if (signature(e) === sig) return { id: e.id, reason: 'same role, company and city' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Input parsing
//
// Input arrives from three places — tracker forms, server actions and AI tools
// through the API — and all of it is untrusted. These accept loose input (any
// case, common synonyms, snake_case or camelCase keys) because an AI tool will
// write "on-site", "Onsite" and "office" for the same thing, and reject only
// what cannot be made sense of, with a message that says which field.
// ---------------------------------------------------------------------------

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const lc = (v: unknown) => String(v ?? '').trim().toLowerCase();

function pickEnum<T extends string>(values: readonly T[], raw: unknown, synonyms: Record<string, T> = {}): T | null {
  const v = lc(raw);
  if (!v) return null;
  const direct = values.find((x) => x.toLowerCase() === v);
  if (direct) return direct;
  const compact = v.replace(/[^a-z0-9]+/g, ' ').trim();
  return own(synonyms, compact) ?? own(synonyms, v) ?? null;
}

/**
 * A lookup that only sees the table's own keys. A plain `table[input]` also
 * finds everything on Object.prototype, so "constructor" came back as the
 * Object function and passed every enum check.
 */
export function own<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

const STATUS_SYNONYMS: Record<string, JobStatus> = {
  new: 'Found',
  found: 'Found',
  saved: 'Shortlisted',
  shortlist: 'Shortlisted',
  interested: 'Shortlisted',
  'to apply': 'Shortlisted',
  'want to apply': 'Shortlisted',
  apply: 'Shortlisted',
  applied: 'Applied',
  sent: 'Applied',
  oa: 'Assessment',
  'online assessment': 'Assessment',
  assessment: 'Assessment',
  test: 'Assessment',
  assignment: 'Assessment',
  'take home': 'Assessment',
  interview: 'Interviewing',
  interviews: 'Interviewing',
  interviewing: 'Interviewing',
  onsite: 'Interviewing',
  offer: 'Offer',
  offered: 'Offer',
  rejected: 'Rejected',
  rejection: 'Rejected',
  declined: 'Rejected',
  ghosted: 'Ghosted',
  'no response': 'Ghosted',
  withdrawn: 'Withdrawn',
  withdrew: 'Withdrawn',
  skipped: 'Skipped',
  skip: 'Skipped',
  'not a fit': 'Skipped',
  'not interested': 'Skipped',
  archived: 'Skipped',
};

export function coerceStatus(raw: unknown): JobStatus | null {
  return pickEnum(JOB_STATUS, raw, STATUS_SYNONYMS);
}

const SOURCE_SYNONYMS: Record<string, JobSource> = {
  linkedin: 'LinkedIn',
  'linkedin easy apply': 'LinkedIn',
  naukri: 'Naukri',
  'naukri com': 'Naukri',
  glassdoor: 'Glassdoor',
  workday: 'Workday',
  monster: 'foundit',
  'monster india': 'foundit',
  foundit: 'foundit',
  angellist: 'Wellfound',
  'angel list': 'Wellfound',
  wellfound: 'Wellfound',
  instahyre: 'Instahyre',
  cutshort: 'Cutshort',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  company: 'Company site',
  'company website': 'Company site',
  'careers page': 'Company site',
  'career page': 'Company site',
  careers: 'Company site',
  website: 'Company site',
  referral: 'Referral',
  referred: 'Referral',
  other: 'Other',
};

export function coerceSource(raw: unknown): JobSource | null {
  return pickEnum(JOB_SOURCES, raw, SOURCE_SYNONYMS);
}

/** The board a URL belongs to, for rows that arrive without a source. */
export function sourceFromUrl(rawUrl: string | null | undefined): JobSource | null {
  if (!rawUrl) return null;
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  const rules: [RegExp, JobSource][] = [
    [/(^|\.)linkedin\.com$/, 'LinkedIn'],
    [/(^|\.)naukri\.com$/, 'Naukri'],
    [/(^|\.)glassdoor\./, 'Glassdoor'],
    [/myworkday(jobs|site)\.com$/, 'Workday'],
    [/(^|\.)(foundit\.in|monsterindia\.com)$/, 'foundit'],
    [/(^|\.)(wellfound\.com|angel\.co)$/, 'Wellfound'],
    [/(^|\.)instahyre\.com$/, 'Instahyre'],
    [/(^|\.)cutshort\.io$/, 'Cutshort'],
    [/(^|\.)greenhouse\.io$/, 'Greenhouse'],
    [/(^|\.)lever\.co$/, 'Lever'],
    [/(^|\.)ashbyhq\.com$/, 'Ashby'],
  ];
  for (const [re, source] of rules) if (re.test(host)) return source;
  return 'Company site';
}

const WORK_MODE_SYNONYMS: Record<string, WorkMode> = {
  remote: 'Remote',
  wfh: 'Remote',
  'work from home': 'Remote',
  'fully remote': 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
  'on site': 'On-site',
  office: 'On-site',
  'in office': 'On-site',
  wfo: 'On-site',
  'work from office': 'On-site',
};

export function coerceWorkMode(raw: unknown): WorkMode | null {
  return pickEnum(WORK_MODES, raw, WORK_MODE_SYNONYMS);
}

const APPLIED_VIA_SYNONYMS: Record<string, AppliedVia> = {
  'easy apply': 'LinkedIn Easy Apply',
  linkedin: 'LinkedIn Easy Apply',
  portal: 'Company site',
  'careers page': 'Company site',
  'company website': 'Company site',
  website: 'Company site',
  workday: 'Company site',
  naukri: 'Naukri',
  referral: 'Referral',
  referred: 'Referral',
  email: 'Email',
  mail: 'Email',
  recruiter: 'Recruiter',
  hr: 'Recruiter',
};

export function coerceAppliedVia(raw: unknown): AppliedVia | null {
  const v = pickEnum(APPLIED_VIA, raw, APPLIED_VIA_SYNONYMS);
  if (v) return v;
  return lc(raw) ? 'Other' : null;
}

/** Plain text: control characters out, runs of blank lines collapsed, capped. */
export function cleanText(raw: unknown, max: number): string {
  if (raw === null || raw === undefined) return '';
  const s = String(raw)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

/** A single-line field. */
export const cleanLine = (raw: unknown, max: number) => cleanText(raw, max).replace(/\s+/g, ' ');

/**
 * An http(s) URL, or null. Anything else — `javascript:`, `data:`, a bare
 * word — is refused, because these end up as links someone clicks.
 */
export function cleanUrl(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  for (const k of [...u.searchParams.keys()]) {
    if (/^utm_|^(gclid|fbclid|msclkid|trk|trkinfo|refid|trackingid|lipi|ebp)$/i.test(k)) u.searchParams.delete(k);
  }
  const out = u.toString();
  return out.length > LIMITS.url ? null : out;
}

/** A day key from `YYYY-MM-DD` or an ISO timestamp; null when absent or invalid. */
export function cleanDate(raw: unknown): DayKey | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  const day = v.slice(0, 10);
  return isDayKey(day) ? day : null;
}

export function cleanSkills(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[,;\n]/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    // Notion refuses commas inside a select option's name.
    const s = cleanLine(String(item ?? '').replace(/,/g, ' '), LIMITS.skill);
    const k = s.toLowerCase();
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= LIMITS.skills) break;
  }
  return out;
}

export function cleanMatch(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/%$/, '').trim());
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Reads a field by snake_case name, falling back to camelCase. */
function field(o: Record<string, unknown>, snake: string): unknown {
  if (snake in o) return o[snake];
  const camel = snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return o[camel];
}
const has = (o: Record<string, unknown>, snake: string) =>
  snake in o || snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()) in o;

/** The input field names, as the API and forms spell them. */
const FIELD_NAMES = {
  role: 'role',
  company: 'company',
  status: 'status',
  source: 'source',
  location: 'location',
  workMode: 'work_mode',
  jobUrl: 'job_url',
  applyUrl: 'apply_url',
  match: 'match',
  fit: 'why_it_fits',
  howToApply: 'how_to_apply',
  salary: 'salary',
  experience: 'experience',
  skills: 'skills',
  postedOn: 'posted_on',
  appliedOn: 'applied_on',
  appliedVia: 'applied_via',
  resume: 'resume_used',
  referral: 'referral',
  contact: 'contact',
  nextStep: 'next_step',
  followUpOn: 'follow_up_on',
  notes: 'notes',
} as const satisfies Record<keyof JobFields, string>;

export const JOB_INPUT_FIELDS = FIELD_NAMES;

/**
 * Parses one field. Returns `undefined` when the value is present but unusable
 * in a way worth reporting — a date that is not a date, a URL that is not one.
 */
function parseField<K extends keyof JobFields>(
  k: K,
  raw: unknown,
): { ok: true; value: JobFields[K] } | { ok: false; error: string } {
  const name = FIELD_NAMES[k];
  const empty = raw === null || raw === undefined || String(raw).trim() === '';
  const ok = <V>(value: V) => ({ ok: true as const, value: value as unknown as JobFields[K] });
  switch (k) {
    case 'role':
    case 'company':
      return ok(cleanLine(raw, LIMITS.name));
    case 'status': {
      if (empty) return { ok: false, error: `${name} is empty` };
      const s = coerceStatus(raw);
      return s ? ok(s) : { ok: false, error: `${name} must be one of: ${JOB_STATUS.join(', ')}` };
    }
    case 'source':
      return ok(empty ? null : (coerceSource(raw) ?? 'Other'));
    case 'workMode': {
      if (empty) return ok(null);
      const m = coerceWorkMode(raw);
      return m ? ok(m) : { ok: false, error: `${name} must be Remote, Hybrid or On-site` };
    }
    case 'jobUrl':
    case 'applyUrl': {
      if (empty) return ok(null);
      const u = cleanUrl(raw);
      return u ? ok(u) : { ok: false, error: `${name} must be an http(s) link` };
    }
    case 'match':
      return ok(cleanMatch(raw));
    case 'postedOn':
    case 'appliedOn':
    case 'followUpOn': {
      if (empty) return ok(null);
      const d = cleanDate(raw);
      return d ? ok(d) : { ok: false, error: `${name} must be a date as YYYY-MM-DD` };
    }
    case 'appliedVia':
      return ok(coerceAppliedVia(raw));
    case 'skills':
      return ok(cleanSkills(raw));
    case 'fit':
    case 'howToApply':
    case 'notes':
      return ok(cleanText(raw, LIMITS.long));
    case 'salary':
    case 'experience':
    case 'location':
      return ok(cleanLine(raw, k === 'location' ? LIMITS.location : LIMITS.short));
    case 'resume':
    case 'referral':
    case 'contact':
    case 'nextStep':
      return ok(cleanText(raw, LIMITS.medium));
  }
  return { ok: false, error: `unknown field ${String(k)}` };
}

/**
 * A new job. Role and company are required; everything else is optional and
 * defaults to empty. `defaults.status` is the status a row starts in when the
 * caller does not say — Found for an AI tool's discovery, Shortlisted for a
 * job you add yourself.
 */
export function parseNewJob(raw: unknown, defaults: { status: JobStatus }): Parsed<NewJob> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'each job must be an object' };
  }
  const o = raw as Record<string, unknown>;
  const out: Partial<NewJob> = {};
  for (const k of Object.keys(FIELD_NAMES) as (keyof JobFields)[]) {
    const v = field(o, FIELD_NAMES[k]);
    if (k === 'status' && (v === undefined || v === null || v === '')) {
      out.status = defaults.status;
      continue;
    }
    const r = parseField(k, v);
    if (!r.ok) return r;
    (out as Record<string, unknown>)[k] = r.value;
  }
  if (!out.role) return { ok: false, error: 'role is required' };
  if (!out.company) return { ok: false, error: 'company is required' };
  out.source = out.source ?? sourceFromUrl(out.jobUrl) ?? sourceFromUrl(out.applyUrl);
  out.description = cleanText(field(o, 'description'), LIMITS.description);
  return { ok: true, value: out as NewJob };
}

/**
 * A change to an existing job. Only the keys present are returned, so a
 * missing key leaves the stored value alone and an empty one clears it.
 */
export function parseJobPatch(raw: unknown): Parsed<JobPatch> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'changes must be an object' };
  }
  const o = raw as Record<string, unknown>;
  const out: JobPatch = {};
  for (const k of Object.keys(FIELD_NAMES) as (keyof JobFields)[]) {
    if (!has(o, FIELD_NAMES[k])) continue;
    const r = parseField(k, field(o, FIELD_NAMES[k]));
    if (!r.ok) return r;
    (out as Record<string, unknown>)[k] = r.value;
  }
  if ('role' in out && !out.role) return { ok: false, error: 'role cannot be empty' };
  if ('company' in out && !out.company) return { ok: false, error: 'company cannot be empty' };
  return { ok: true, value: out };
}

export type EventInput = { kind: JobEventKind; text: string; date: DayKey | null; moveStatus: boolean };

export function parseEventInput(raw: unknown): Parsed<EventInput> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'event must be an object' };
  const o = raw as Record<string, unknown>;
  const kindRaw = lc(field(o, 'kind'));
  const kind = (LOGGABLE_KINDS as readonly string[]).includes(kindRaw)
    ? (kindRaw as JobEventKind)
    : own(EVENT_KIND_SYNONYMS, kindRaw.replace(/[^a-z0-9]+/g, ' ').trim());
  if (!kind) return { ok: false, error: `kind must be one of: ${LOGGABLE_KINDS.join(', ')}` };
  const text = cleanLine(field(o, 'text'), LIMITS.medium);
  const dateRaw = field(o, 'date');
  const date = cleanDate(dateRaw);
  if (dateRaw && !date) return { ok: false, error: 'date must be YYYY-MM-DD' };
  const move = field(o, 'move_status');
  return { ok: true, value: { kind, text, date, moveStatus: move === undefined ? true : move !== false && move !== 'false' } };
}

const EVENT_KIND_SYNONYMS: Record<string, JobEventKind> = {
  apply: 'applied',
  'follow up': 'followup',
  'followed up': 'followup',
  'follow-up': 'followup',
  replied: 'reply',
  response: 'reply',
  email: 'reply',
  'they replied': 'reply',
  'phone call': 'call',
  screen: 'call',
  'recruiter call': 'call',
  oa: 'assessment',
  test: 'assessment',
  'online assessment': 'assessment',
  assignment: 'assessment',
  interviews: 'interview',
  interviewed: 'interview',
  rejected: 'rejection',
  reject: 'rejection',
  offered: 'offer',
  comment: 'note',
};

export function parseProfile(raw: unknown): Parsed<JobProfile> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'profile must be an object' };
  }
  const o = raw as Record<string, unknown>;
  const modes = field(o, 'work_modes');
  const list = Array.isArray(modes) ? modes : String(modes ?? '').split(/[,;]/);
  const workModes = [...new Set(list.map(coerceWorkMode).filter((m): m is WorkMode => Boolean(m)))];
  return {
    ok: true,
    value: {
      targetRoles: cleanText(field(o, 'target_roles'), LIMITS.medium),
      experience: cleanLine(field(o, 'experience'), LIMITS.short),
      locations: cleanText(field(o, 'locations'), LIMITS.medium),
      workModes,
      skills: cleanText(field(o, 'skills'), LIMITS.long),
      salary: cleanLine(field(o, 'salary'), LIMITS.short),
      noticePeriod: cleanLine(field(o, 'notice_period'), LIMITS.short),
      mustHaves: cleanText(field(o, 'must_haves'), LIMITS.long),
      dealBreakers: cleanText(field(o, 'deal_breakers'), LIMITS.long),
      targetCompanies: cleanText(field(o, 'target_companies'), LIMITS.long),
      avoidCompanies: cleanText(field(o, 'avoid_companies'), LIMITS.long),
      resume: cleanText(field(o, 'resume'), LIMITS.resume),
    },
  };
}

/** Only the profile keys present, for partial updates from an AI tool. */
export function parseProfilePatch(raw: unknown): Parsed<Partial<JobProfile>> {
  const full = parseProfile(raw);
  if (!full.ok) return full;
  const o = raw as Record<string, unknown>;
  const names: Record<keyof JobProfile, string> = {
    targetRoles: 'target_roles',
    experience: 'experience',
    locations: 'locations',
    workModes: 'work_modes',
    skills: 'skills',
    salary: 'salary',
    noticePeriod: 'notice_period',
    mustHaves: 'must_haves',
    dealBreakers: 'deal_breakers',
    targetCompanies: 'target_companies',
    avoidCompanies: 'avoid_companies',
    resume: 'resume',
  };
  const out: Partial<JobProfile> = {};
  for (const [k, snake] of Object.entries(names) as [keyof JobProfile, string][]) {
    if (has(o, snake)) (out as Record<string, unknown>)[k] = full.value[k];
  }
  return { ok: true, value: out };
}

/** True when there is enough in the profile to search with. */
export function profileIsUsable(p: JobProfile): boolean {
  return Boolean(p.targetRoles.trim() || p.resume.trim());
}

/**
 * Splits text into Notion-sized runs. Notion caps a single text run at 2,000
 * characters but accepts up to 100 runs in one property, so a long resume is
 * stored whole rather than cut off.
 */
export function textRuns(s: string, size = 2000): string[] {
  if (!s) return [];
  const out: string[] = [];
  for (let i = 0; i < s.length && out.length < 100; i += size) out.push(s.slice(i, i + size));
  return out;
}
