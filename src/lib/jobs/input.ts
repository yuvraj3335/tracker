/**
 * Accepting input from forms, server actions and AI tools.
 */
import { APPLIED_VIA, JOB_SOURCES, JOB_STATUS, WORK_MODES, type AppliedVia, type JobSource, type JobStatus, type WorkMode } from '../schema';
import { isDayKey, type DayKey } from '../date';
import { LIMITS, LOGGABLE_KINDS, own, type JobEventKind, type JobFields, type JobPatch, type JobProfile, type NewJob } from './model';

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

export function pickEnum<T extends string>(values: readonly T[], raw: unknown, synonyms: Record<string, T> = {}): T | null {
  const v = lc(raw);
  if (!v) return null;
  const direct = values.find((x) => x.toLowerCase() === v);
  if (direct) return direct;
  const compact = v.replace(/[^a-z0-9]+/g, ' ').trim();
  return own(synonyms, compact) ?? own(synonyms, v) ?? null;
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
  smartrecruiters: 'SmartRecruiters',
  'smart recruiters': 'SmartRecruiters',
  workable: 'Workable',
  oracle: 'Oracle',
  'oracle cloud': 'Oracle',
  taleo: 'Oracle',
  himalayas: 'Himalayas',
  getro: 'VC job board',
  'vc board': 'VC job board',
  'vc job board': 'VC job board',
  'portfolio jobs': 'VC job board',
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
    [/(^|\.)smartrecruiters\.com$/, 'SmartRecruiters'],
    [/(^|\.)workable\.com$/, 'Workable'],
    [/\.oraclecloud\.com$/, 'Oracle'],
    [/(^|\.)himalayas\.app$/, 'Himalayas'],
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
    if (typeof item !== 'string' && typeof item !== 'number') continue;
    // Notion refuses commas inside a select option's name.
    const s = cleanLine(String(item).replace(/,/g, ' '), LIMITS.skill);
    const k = s.toLowerCase();
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= LIMITS.skills) break;
  }
  return out;
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

/** A checkbox from a form ("on"), JSON (true) or an AI tool ("yes"). */
const truthy = (v: unknown) => v === true || ['on', 'true', 'yes', '1'].includes(lc(v));

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
      minSalary: cleanLine(field(o, 'min_salary'), LIMITS.short),
      noticePeriod: cleanLine(field(o, 'notice_period'), LIMITS.short),
      relocation: truthy(field(o, 'open_to_relocation')),
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
    minSalary: 'min_salary',
    noticePeriod: 'notice_period',
    relocation: 'open_to_relocation',
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
