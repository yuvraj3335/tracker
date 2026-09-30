/**
 * The rubric: how a job is judged, the same way by every AI tool. No I/O.
 *
 * Adapted from career-ops (github.com/career-ops-hq/career-ops, MIT), whose
 * evaluation ends in a 1–5 score and tells you not to apply below 4.0 — "apply
 * better to fewer". Two deliberate differences:
 *
 *   - The score here is arithmetic, not holistic. Several different AI tools
 *     write to one tracker, and left to its own judgment each one would weigh
 *     things its own way. So a tool scores five dimensions against the anchors
 *     below, and this file turns those scores into the match and the verdict —
 *     identically, whichever tool did the reading.
 *   - The anchors are relative to the profile rather than to one person's
 *     targets, so the rubric fits an SDE-1 in Bengaluru and whoever comes next.
 *
 * The verdict is advice. Nothing here, or anywhere, moves a job's status
 * because of it: a person decides.
 */
import {
  EVAL_DEPTHS,
  HARD_STOPS,
  LEGITIMACY,
  RED_FLAGS,
  ROLE_FAMILIES,
  type EvalDepth,
  type HardStop,
  type Legitimacy,
  type LevelFit,
  type RedFlag,
  type RoleFamily,
  type Verdict,
} from '../schema';
import { daysBetween, type DayKey } from '../date';
import { own, type DimensionId, type DimensionScores } from './model';
import { cleanLine, cleanSkills, cleanText, pickEnum, type Parsed } from './input';

export const RUBRIC_VERSION = 'v1';

/** Each dimension, what it weighs, and what a 5, a 3 and a 1 mean. */
export const DIMENSIONS: readonly {
  id: DimensionId;
  label: string;
  weight: number;
  anchors: { 5: string; 3: string; 1: string };
}[] = [
  {
    id: 'skills',
    label: 'Skills',
    weight: 0.3,
    anchors: {
      5: 'the resume shows 80% or more of the must-have skills',
      3: 'the resume shows about half of them',
      1: 'the resume shows few of them',
    },
  },
  {
    id: 'level',
    label: 'Level',
    weight: 0.25,
    anchors: {
      5: "the level the profile has (for 0–2 years: SDE-1, new grad, '0–2 years')",
      3: "one step up and open to it ('2–4 years preferred' for a 0–2 year profile)",
      1: 'firmly above it (3+ years required, SDE-2, a senior title)',
    },
  },
  {
    id: 'location',
    label: 'Location',
    weight: 0.15,
    anchors: {
      5: "remote and open to the profile's country, or a target city in a wanted work mode",
      3: 'a target city, in a work mode the profile would rather not have',
      1: 'another city without relocation, or a region the profile cannot work from',
    },
  },
  {
    id: 'pay',
    label: 'Pay',
    weight: 0.15,
    anchors: {
      5: 'stated fixed pay at or above the target salary',
      3: 'not stated, or between the minimum and the target',
      1: 'below the minimum salary',
    },
  },
  {
    id: 'role',
    label: 'Role',
    weight: 0.15,
    anchors: {
      5: 'a target role at a company worth joining',
      3: 'an adjacent role',
      1: 'a role or company the profile avoids',
    },
  },
];

/** Pay is the one dimension a posting often says nothing about; unknown scores as the middle. */
export const UNKNOWN_SCORE = 3;
export const RED_FLAG_COST = 10;
/** More flags than this stop counting: past three, the verdict is already Skip. */
const MAX_COUNTED_FLAGS = 3;
/** A hard stop caps the match, whatever the rest scores. */
export const HARD_STOP_CAP = 50;

/** The lines. `APPLY_AT` is career-ops's 4.0 on a 0–100 scale. */
export const APPLY_AT = 80;
export const CONSIDER_AT = 70;
/** A quick look never says Apply: at best it says the posting is worth reading. */
export const QUICK_PROMISING_AT = 70;
export const QUICK_CONSIDER_AT = 60;

/** A posting older than this is flagged; age alone never rules one out. */
export const STALE_POSTING_DAYS = 45;

/** 0–100 from the five scores, the red flags and the hard stops. */
export function computeMatch(
  scores: DimensionScores,
  redFlags: readonly string[] = [],
  hardStops: readonly string[] = [],
): number {
  let total = 0;
  for (const d of DIMENSIONS) total += d.weight * (scores[d.id] ?? UNKNOWN_SCORE);
  let m = Math.round(total * 20) - RED_FLAG_COST * Math.min(redFlags.length, MAX_COUNTED_FLAGS);
  m = Math.max(0, Math.min(100, m));
  return hardStops.length ? Math.min(m, HARD_STOP_CAP) : m;
}

/**
 * The verdict for a match.
 *
 *   full   Apply ≥ 80, Consider ≥ 70, otherwise Skip
 *   quick  Research first ≥ 70 (worth reading in full), Consider ≥ 60, otherwise Skip
 *
 * A hard stop is always Skip, and a posting that looks suspicious is always
 * Research first — a high score for a job that may not exist is not "apply".
 */
export function verdictFor(o: {
  match: number;
  depth: EvalDepth;
  hardStops?: readonly string[];
  legitimacy?: Legitimacy | null;
}): Verdict {
  if (o.hardStops?.length) return 'Skip';
  if (o.legitimacy === 'Suspicious') return 'Research first';
  if (o.depth === 'Quick') {
    if (o.match >= QUICK_PROMISING_AT) return 'Research first';
    return o.match >= QUICK_CONSIDER_AT ? 'Consider' : 'Skip';
  }
  if (o.match >= APPLY_AT) return 'Apply';
  return o.match >= CONSIDER_AT ? 'Consider' : 'Skip';
}

/** The level fit follows the level score, so the two can never disagree. */
export function levelFitFor(level: number | null): LevelFit | null {
  if (level === null) return null;
  if (level >= 4) return 'On-level';
  return level === 3 ? 'Stretch' : 'Over-level';
}

/** Flags the tracker can see for itself, whatever the evaluation said. */
export function systemRedFlags(job: { postedOn: DayKey | null }, today: DayKey): RedFlag[] {
  return job.postedOn && daysBetween(job.postedOn, today) > STALE_POSTING_DAYS ? ['Stale posting'] : [];
}

/** Found by the tracker, not by a reading, so a later evaluation keeps them. */
const KEPT_FLAGS: ReadonlySet<RedFlag> = new Set(['Reposted']);

/** One list, in the order the schema declares, with nothing twice. */
export function mergeRedFlags(...lists: (readonly RedFlag[])[]): RedFlag[] {
  const all = new Set(lists.flat());
  return RED_FLAGS.filter((f) => all.has(f));
}

export function keptRedFlags(current: readonly RedFlag[]): RedFlag[] {
  return current.filter((f) => KEPT_FLAGS.has(f));
}

// ---------------------------------------------------------------------------
// Scores as one line of text — the Scores property in Notion
// ---------------------------------------------------------------------------

/** "Skills 4 · Level 5 · Location 5 · Pay ? · Role 4": readable in Notion, parseable here. */
export function formatScores(s: DimensionScores): string {
  return DIMENSIONS.map((d) => `${d.label} ${s[d.id] ?? '?'}`).join(' · ');
}

export function parseScores(text: string): DimensionScores | null {
  const out = {} as DimensionScores;
  let found = 0;
  for (const d of DIMENSIONS) {
    const m = new RegExp(`\\b${d.label}\\s+([1-5?])\\b`, 'i').exec(text);
    const v = m ? (m[1] === '?' ? null : Number(m[1])) : null;
    if (m) found++;
    out[d.id] = v;
  }
  return found ? out : null;
}

// ---------------------------------------------------------------------------
// The full report's parts
// ---------------------------------------------------------------------------

export const REQUIREMENT_WEIGHTS = ['Must', 'Core', 'Nice'] as const;
export type RequirementWeight = (typeof REQUIREMENT_WEIGHTS)[number];
export const REQUIREMENT_MATCHES = ['Strong', 'Partial', 'Missing'] as const;
export type RequirementMatch = (typeof REQUIREMENT_MATCHES)[number];

/** One line of the requirements table: what the posting asks, and what the resume shows. */
export type Requirement = {
  requirement: string;
  weight: RequirementWeight;
  match: RequirementMatch;
  /** A quote from the resume for Strong/Partial; what is missing for Missing. */
  evidence: string;
};

/** Everything an evaluation carries. The quick one leaves the report parts empty. */
export type EvaluationInput = {
  depth: EvalDepth;
  scores: DimensionScores;
  notes: Partial<Record<DimensionId, string>>;
  legitimacy: Legitimacy | null;
  hardStops: HardStop[];
  redFlags: RedFlag[];
  roleFamily: RoleFamily | null;
  skillGaps: string[];
  summary: string;
  /** Replaces Why It Fits when given. */
  fit: string | null;
  /** Replaces How To Apply when given. */
  howToApply: string | null;
  requirements: Requirement[];
  levelStrategy: string;
  payNotes: string[];
  legitimacySignals: string[];
  resumeEdits: string[];
  keywords: string[];
  /** The posting, word for word: postings disappear once they close. */
  posting: string;
};

/** What the rubric makes of an evaluation. */
export type Judgment = {
  match: number;
  verdict: Verdict;
  levelFit: LevelFit | null;
  redFlags: RedFlag[];
};

export function judge(
  e: Pick<EvaluationInput, 'depth' | 'scores' | 'hardStops' | 'redFlags' | 'legitimacy'>,
  context: { postedOn: DayKey | null; keptFlags?: readonly RedFlag[]; today: DayKey },
): Judgment {
  const redFlags = mergeRedFlags(e.redFlags, systemRedFlags(context, context.today), context.keptFlags ?? []);
  const match = computeMatch(e.scores, redFlags, e.hardStops);
  return {
    match,
    verdict: verdictFor({ match, depth: e.depth, hardStops: e.hardStops, legitimacy: e.legitimacy }),
    levelFit: levelFitFor(e.scores.level),
    redFlags,
  };
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export const EVAL_LIMITS = {
  note: 300,
  summary: 300,
  requirement: 200,
  evidence: 300,
  requirements: 12,
  strategy: 1500,
  item: 300,
  items: 8,
  keywords: 15,
  skillGaps: 8,
  posting: 30000,
} as const;

const HARD_STOP_SYNONYMS: Record<string, HardStop> = {
  experience: 'Needs more experience',
  'too senior': 'Needs more experience',
  'more experience': 'Needs more experience',
  location: 'Location not open to you',
  'wrong location': 'Location not open to you',
  'not remote for india': 'Location not open to you',
  'region locked': 'Location not open to you',
  pay: 'Below your pay floor',
  salary: 'Below your pay floor',
  'below pay floor': 'Below your pay floor',
  bond: 'Service bond',
  'service agreement': 'Service bond',
  'notice period': 'Notice period too long',
  'immediate joiner': 'Notice period too long',
  'immediate joiners': 'Notice period too long',
  'avoided company': 'Avoided company',
  'avoid company': 'Avoided company',
  'deal breaker': 'Deal-breaker',
  dealbreaker: 'Deal-breaker',
};

const RED_FLAG_SYNONYMS: Record<string, RedFlag> = {
  stale: 'Stale posting',
  old: 'Stale posting',
  'old posting': 'Stale posting',
  repost: 'Reposted',
  reposted: 'Reposted',
  'not on employer site': 'Only on job boards',
  'not on company site': 'Only on job boards',
  aggregator: 'Only on job boards',
  staffing: 'Staffing or contract',
  contract: 'Staffing or contract',
  'contract to hire': 'Staffing or contract',
  'third party payroll': 'Staffing or contract',
  vendor: 'Staffing or contract',
  'unpaid assignment': 'Long unpaid assignment',
  'take home': 'Long unpaid assignment',
  vague: 'Vague description',
  contradictory: 'Contradictory requirements',
  layoffs: 'Recent layoffs',
};

const ROLE_FAMILY_SYNONYMS: Record<string, RoleFamily> = {
  'back end': 'Backend',
  backend: 'Backend',
  'front end': 'Frontend',
  frontend: 'Frontend',
  'full stack': 'Full-stack',
  fullstack: 'Full-stack',
  android: 'Mobile',
  ios: 'Mobile',
  data: 'Data/ML',
  ml: 'Data/ML',
  'data ml': 'Data/ML',
  'machine learning': 'Data/ML',
  devops: 'DevOps/SRE',
  sre: 'DevOps/SRE',
  platform: 'DevOps/SRE',
  qa: 'SDET',
  test: 'SDET',
  testing: 'SDET',
  sde: 'Generalist SDE',
  generalist: 'Generalist SDE',
  'software engineer': 'Generalist SDE',
};

const WEIGHT_SYNONYMS: Record<string, RequirementWeight> = {
  must: 'Must',
  required: 'Must',
  critical: 'Must',
  high: 'Must',
  core: 'Core',
  meaningful: 'Core',
  medium: 'Core',
  important: 'Core',
  nice: 'Nice',
  'nice to have': 'Nice',
  preferred: 'Nice',
  bonus: 'Nice',
  low: 'Nice',
};

const MATCH_SYNONYMS: Record<string, RequirementMatch> = {
  strong: 'Strong',
  yes: 'Strong',
  full: 'Strong',
  met: 'Strong',
  partial: 'Partial',
  some: 'Partial',
  weak: 'Partial',
  missing: 'Missing',
  no: 'Missing',
  gap: 'Missing',
  none: 'Missing',
};

/** Reads a field by snake_case name, falling back to camelCase. */
function field(o: Record<string, unknown>, snake: string): unknown {
  if (snake in o) return o[snake];
  const camel = snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return o[camel];
}

const asObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function score(raw: unknown, name: string, optional: boolean): { ok: true; value: number | null } | { ok: false; error: string } {
  const empty = raw === null || raw === undefined || ['', '?', 'unknown', 'n/a', 'not stated'].includes(String(raw).trim().toLowerCase());
  if (empty) return optional ? { ok: true, value: null } : { ok: false, error: `scores.${name} is required (1-5)` };
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 1 || n > 5) return { ok: false, error: `scores.${name} must be 1-5` };
  return { ok: true, value: Math.round(n) };
}

/** Only text survives: an object would otherwise be saved as "[object Object]". */
const texty = (v: unknown): v is string | number => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));

function list(raw: unknown, max: number, each: number): string[] {
  const items = Array.isArray(raw) ? raw : raw === null || raw === undefined || raw === '' ? [] : [raw];
  return items
    .filter(texty)
    .map((i) => cleanLine(i, each))
    .filter(Boolean)
    .slice(0, max);
}

/**
 * Text the evaluation may replace. Absent, null or blank all mean "not given":
 * some clients send every optional parameter as null, and taking that as
 * "clear it" would erase what the user wrote.
 */
function optionalText(raw: unknown, max: number): string | null {
  if (!texty(raw)) return null;
  const s = cleanText(raw, max);
  return s || null;
}

/** Enum values from a list, or the name of the first one that is not one. */
function enums<T extends string>(raw: unknown, values: readonly T[], synonyms: Record<string, T>, name: string): Parsed<T[]> {
  const items = Array.isArray(raw) ? raw : raw === null || raw === undefined || raw === '' ? [] : [raw];
  const out: T[] = [];
  for (const i of items) {
    const v = pickEnum(values, i, synonyms);
    if (!v) return { ok: false, error: `${name} must be from: ${values.join(', ')} (got "${cleanLine(i, 60)}")` };
    if (!out.includes(v)) out.push(v);
  }
  return { ok: true, value: out };
}

/**
 * An evaluation from an AI tool. The four dimensions a listing always shows are
 * required; pay may be unknown. A full evaluation also needs a legitimacy tier
 * and at least one requirement, because a "full" report without them is a
 * quick one with a longer name.
 */
export function parseEvaluation(raw: unknown, defaults: { depth: EvalDepth }): Parsed<EvaluationInput> {
  const o = asObject(raw);
  if (!o) return { ok: false, error: 'evaluation must be an object' };

  const depthRaw = field(o, 'depth');
  const depth = depthRaw === undefined || depthRaw === null || depthRaw === '' ? defaults.depth : pickEnum(EVAL_DEPTHS, depthRaw);
  if (!depth) return { ok: false, error: 'depth must be quick or full' };

  const s = asObject(field(o, 'scores'));
  if (!s) return { ok: false, error: 'scores is required: skills, level, location, pay and role, 1-5 each' };
  const scores = {} as DimensionScores;
  for (const d of DIMENSIONS) {
    const r = score(s[d.id], d.id, d.id === 'pay');
    if (!r.ok) return r;
    scores[d.id] = r.value;
  }

  const notesRaw = asObject(field(o, 'score_notes')) ?? {};
  const notes: Partial<Record<DimensionId, string>> = {};
  for (const d of DIMENSIONS) {
    const v = own(notesRaw, d.id);
    const n = texty(v) ? cleanLine(v, EVAL_LIMITS.note) : '';
    if (n) notes[d.id] = n;
  }

  const legRaw = field(o, 'legitimacy');
  const legitimacy = legRaw === undefined || legRaw === null || legRaw === '' ? null : pickEnum(LEGITIMACY, legRaw, { low: 'Suspicious', medium: 'Caution', proceed: 'Caution', caution: 'Caution', ok: 'High', fine: 'High' });
  if (legRaw && !legitimacy) return { ok: false, error: `legitimacy must be one of: ${LEGITIMACY.join(', ')}` };

  const hardStops = enums(field(o, 'hard_stops'), HARD_STOPS, HARD_STOP_SYNONYMS, 'hard_stops');
  if (!hardStops.ok) return hardStops;
  const redFlags = enums(field(o, 'red_flags'), RED_FLAGS, RED_FLAG_SYNONYMS, 'red_flags');
  if (!redFlags.ok) return redFlags;

  const famRaw = field(o, 'role_family');
  const roleFamily = famRaw === undefined || famRaw === null || famRaw === '' ? null : pickEnum(ROLE_FAMILIES, famRaw, ROLE_FAMILY_SYNONYMS) ?? 'Other';

  const requirements: Requirement[] = [];
  const reqRaw = field(o, 'requirements');
  for (const item of (Array.isArray(reqRaw) ? reqRaw : []).slice(0, EVAL_LIMITS.requirements)) {
    const r = asObject(item);
    if (!r) return { ok: false, error: 'each requirement must be an object' };
    const requirement = cleanLine(field(r, 'requirement'), EVAL_LIMITS.requirement);
    if (!requirement) return { ok: false, error: 'each requirement needs its text' };
    requirements.push({
      requirement,
      weight: pickEnum(REQUIREMENT_WEIGHTS, field(r, 'weight'), WEIGHT_SYNONYMS) ?? 'Core',
      match: pickEnum(REQUIREMENT_MATCHES, field(r, 'match'), MATCH_SYNONYMS) ?? 'Partial',
      evidence: cleanLine(field(r, 'evidence'), EVAL_LIMITS.evidence),
    });
  }

  if (depth === 'Full') {
    if (!legitimacy) return { ok: false, error: `a full evaluation needs legitimacy: ${LEGITIMACY.join(', ')}` };
    if (!requirements.length) return { ok: false, error: 'a full evaluation needs the requirements table: requirement, weight, match, evidence' };
  }

  return {
    ok: true,
    value: {
      depth,
      scores,
      notes,
      legitimacy,
      hardStops: hardStops.value,
      redFlags: redFlags.value,
      roleFamily,
      skillGaps: cleanSkills(field(o, 'skill_gaps')).slice(0, EVAL_LIMITS.skillGaps),
      summary: texty(field(o, 'summary')) ? cleanLine(field(o, 'summary'), EVAL_LIMITS.summary) : '',
      fit: optionalText(field(o, 'why_it_fits'), 4000),
      howToApply: optionalText(field(o, 'how_to_apply'), 4000),
      requirements,
      levelStrategy: optionalText(field(o, 'level_strategy'), EVAL_LIMITS.strategy) ?? '',
      payNotes: list(field(o, 'pay_notes'), EVAL_LIMITS.items, EVAL_LIMITS.item),
      legitimacySignals: list(field(o, 'legitimacy_signals'), EVAL_LIMITS.items, EVAL_LIMITS.item),
      resumeEdits: list(field(o, 'resume_edits'), EVAL_LIMITS.items, EVAL_LIMITS.item),
      keywords: cleanSkills(field(o, 'keywords')).slice(0, EVAL_LIMITS.keywords),
      posting: optionalText(field(o, 'posting_text'), EVAL_LIMITS.posting) ?? '',
    },
  };
}
