/**
 * The tracker's tools, as any AI assistant sees them over MCP. The playbook they
 * follow is in ./playbook, the protocol in ./protocol, HTTP in ./http.
 *
 * This file is the portable half of "use it from any AI tool": the playbook
 * below travels with the server, so Claude Code, Codex, Gemini CLI and Claude
 * Desktop all run the same job hunt the same way, with nothing to install on
 * the tool's side beyond the connection itself.
 */
import { createRateLimiter, retryAfterSeconds } from '../rate-limit';
import { todayKey, type DayKey } from '../date';
import {
  JOB_INPUT_FIELDS,
  LIMITS,
  LOGGABLE_KINDS,
  followUpFor,
  parseEventInput,
  parseJobPatch,
  parseNewJob,
  parseProfilePatch,
  pipelineSummary,
  profileIsUsable,
  searchJobs,
  coerceStatus,
  type Job,
  type NewJob,
} from '../jobs';
import {
  JobsError,
  addJobs,
  getJob,
  getJobs,
  getProfile,
  logJobEvent,
  saveProfile,
  updateJob,
  type Actor,
} from '../jobs/notion';
import { ToolError, jsonResult, type ServerDef, type ToolDef } from './protocol';
import { clampInt } from '../utils';
import { INSTRUCTIONS, PLAYBOOK, prompts } from './playbook';
import { CAREER_SITES, companiesFrom, searchCompanySites } from '../job-search/career-sites';
import { APPLIED_VIA, JOB_SOURCES, JOB_STATUS, WORK_MODES } from '../schema';
import type { Tenant } from '../tenant';

export type ToolContext = {
  tenant: Tenant;
  actor: Actor;
  keyId: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Searches fan out to dozens of career sites, so they get their own ceiling. */
const searchCalls = createRateLimiter(40, 10 * 60_000);

function limit(take: ReturnType<typeof createRateLimiter>, key: string, what: string) {
  const d = take(key);
  if (!d.allowed) {
    throw new ToolError(`Too many ${what} for now. Try again in ${retryAfterSeconds(d.retryAfterMs)} seconds.`);
  }
}

/** Translates the domain's own errors into messages for the model to relay. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ToolError) throw e;
    if (e instanceof JobsError) throw new ToolError(e.message);
    if ((e as { friendly?: boolean })?.friendly) throw new ToolError((e as Error).message);
    throw e;
  }
}

/** One job as tools return it: flat, snake_case, only what is useful to reason with. */
export function compactJob(j: Job, today: DayKey) {
  const f = followUpFor(j, today);
  return {
    id: j.id,
    role: j.role,
    company: j.company,
    status: j.status,
    location: j.location || null,
    source: j.source,
    work_mode: j.workMode,
    match: j.match,
    posted_on: j.postedOn,
    found_on: j.foundOn,
    applied_on: j.appliedOn,
    applied_via: j.appliedVia,
    heard_back_on: j.heardBackOn,
    follow_up_on: j.followUpOn,
    follow_up: f ? `${f.kind} (${f.days} days)` : null,
    next_step: j.nextStep || null,
    last_update: j.lastUpdate,
    job_url: j.jobUrl,
    apply_url: j.applyUrl,
  };
}

function fullJob(j: Job, today: DayKey) {
  return {
    ...compactJob(j, today),
    experience: j.experience || null,
    salary: j.salary || null,
    skills: j.skills,
    why_it_fits: j.fit || null,
    how_to_apply: j.howToApply || null,
    resume_used: j.resume || null,
    referral: j.referral || null,
    contact: j.contact || null,
    notes: j.notes || null,
    added_by: j.addedBy,
    notion_url: j.notionUrl,
  };
}

// ---------------------------------------------------------------------------
// Input schemas (JSON Schema, as MCP clients expect)
// ---------------------------------------------------------------------------

const S = {
  str: (description: string, maxLength?: number) => ({ type: 'string', description, ...(maxLength ? { maxLength } : {}) }),
  date: (description: string) => ({ type: 'string', description: `${description} (YYYY-MM-DD)`, pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  url: (description: string) => ({ type: 'string', description, format: 'uri' }),
  enum: (values: readonly string[], description: string) => ({ type: 'string', enum: [...values], description }),
};

const JOB_FIELD_SCHEMA: Record<string, unknown> = {
  [JOB_INPUT_FIELDS.role]: S.str('Job title as posted', LIMITS.name),
  [JOB_INPUT_FIELDS.company]: S.str('Company name', LIMITS.name),
  [JOB_INPUT_FIELDS.status]: S.enum(JOB_STATUS, 'Pipeline stage'),
  [JOB_INPUT_FIELDS.source]: S.enum(JOB_SOURCES, 'Where the job was found'),
  [JOB_INPUT_FIELDS.location]: S.str('City/region as posted, e.g. "Bengaluru, India"', LIMITS.location),
  [JOB_INPUT_FIELDS.workMode]: S.enum(WORK_MODES, 'Remote, Hybrid or On-site, only if stated'),
  [JOB_INPUT_FIELDS.jobUrl]: S.url('The posting'),
  [JOB_INPUT_FIELDS.applyUrl]: S.url('Direct application link, if different from the posting'),
  [JOB_INPUT_FIELDS.match]: { type: 'integer', minimum: 0, maximum: 100, description: 'Fit against the profile, 0-100' },
  [JOB_INPUT_FIELDS.fit]: S.str('1-3 sentences: specific overlaps and gaps', LIMITS.long),
  [JOB_INPUT_FIELDS.howToApply]: S.str('Numbered steps: where to apply, what to lead with, referral, requirements', LIMITS.long),
  [JOB_INPUT_FIELDS.salary]: S.str('Salary/CTC as posted', LIMITS.short),
  [JOB_INPUT_FIELDS.experience]: S.str('Required experience as posted, e.g. "0-2 years"', LIMITS.short),
  [JOB_INPUT_FIELDS.skills]: { type: 'array', items: { type: 'string', maxLength: LIMITS.skill }, maxItems: LIMITS.skills, description: 'Key skills from the posting' },
  [JOB_INPUT_FIELDS.postedOn]: S.date('When it was posted'),
  [JOB_INPUT_FIELDS.appliedOn]: S.date('When the user applied'),
  [JOB_INPUT_FIELDS.appliedVia]: S.enum(APPLIED_VIA, 'How the user applied'),
  [JOB_INPUT_FIELDS.resume]: S.str('Which resume version was sent', LIMITS.medium),
  [JOB_INPUT_FIELDS.referral]: S.str('Who referred the user', LIMITS.medium),
  [JOB_INPUT_FIELDS.contact]: S.str('Recruiter or contact, with email if known', LIMITS.medium),
  [JOB_INPUT_FIELDS.nextStep]: S.str('What happens next', LIMITS.medium),
  [JOB_INPUT_FIELDS.followUpOn]: S.date('When to follow up'),
  [JOB_INPUT_FIELDS.notes]: S.str('Anything else', LIMITS.long),
};

const ID = { type: 'string', description: 'The job id from list_jobs, get_job or add_jobs' };

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const tools: ToolDef<ToolContext>[] = [
  {
    name: 'get_job_hunt_playbook',
    title: 'Job hunt playbook',
    description: 'How to run a job search and record applications with this tracker, step by step. Read it before searching for jobs.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async () => ({ content: [{ type: 'text', text: PLAYBOOK }] }),
  },

  {
    name: 'get_job_profile',
    title: 'Get job search profile',
    description:
      "The user's job search profile: target roles, experience, locations, work modes, skills, salary, notice period, must-haves, deal-breakers, target and avoided companies, and resume text. Use it to tailor every search and to score matches.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (_args, ctx) =>
      guard(async () => {
        const p = await getProfile(ctx.tenant);
        if (!p) throw new ToolError('The job profile is missing. Open the tracker and set up job tracking again.');
        return jsonResult({
          today: todayKey(),
          usable: profileIsUsable(p),
          ...(profileIsUsable(p)
            ? {}
            : { hint: 'The profile is empty. Ask the user for target roles, experience and locations, or have them fill it in under Jobs → Profile.' }),
          profile: {
            target_roles: p.targetRoles,
            experience: p.experience,
            locations: p.locations,
            work_modes: p.workModes,
            skills: p.skills,
            salary: p.salary,
            notice_period: p.noticePeriod,
            must_haves: p.mustHaves,
            deal_breakers: p.dealBreakers,
            target_companies: p.targetCompanies,
            avoid_companies: p.avoidCompanies,
            resume: p.resume,
          },
          updated_at: p.updatedAt,
        });
      }),
  },

  {
    name: 'update_job_profile',
    title: 'Update job search profile',
    description:
      'Changes fields of the job search profile. Only the fields given are changed. Use it when the user states a preference ("only remote", "no service companies", "notice period is 30 days").',
    inputSchema: {
      type: 'object',
      properties: {
        target_roles: S.str('Roles to search for, e.g. "SDE-1, Software Engineer, Backend Engineer"'),
        experience: S.str('e.g. "1 year" or "0-2 years"'),
        locations: S.str('Cities and/or Remote'),
        work_modes: { type: 'array', items: { type: 'string', enum: [...WORK_MODES] } },
        skills: S.str('Skills and stack'),
        salary: S.str('Expected salary/CTC'),
        notice_period: S.str('e.g. "30 days"'),
        must_haves: S.str('Anything a job must have'),
        deal_breakers: S.str('Anything that rules a job out'),
        target_companies: S.str('Companies to prioritise'),
        avoid_companies: S.str('Companies to skip'),
        resume: S.str('Full resume text', LIMITS.resume),
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (args, ctx) =>
      guard(async () => {
        const parsed = parseProfilePatch(args);
        if (!parsed.ok) throw new ToolError(parsed.error);
        if (!Object.keys(parsed.value).length) throw new ToolError('Give at least one field to change.');
        const p = await saveProfile(ctx.tenant, parsed.value);
        return jsonResult({ saved: Object.keys(parsed.value), usable: profileIsUsable(p), resume_characters: p.resume.length });
      }),
  },

  {
    name: 'search_company_jobs',
    title: 'Search company career sites',
    description: `Searches company career sites directly — Workday, Greenhouse, Lever and Ashby — for one role. Covers ${CAREER_SITES.length} companies hiring in India, among them Stripe, Databricks, Datadog, Visa, NVIDIA, Adobe, Salesforce, Mastercard, Meesho, Groww and CRED, plus the target companies in the profile — or only the companies you name. Free and fast; works without the local connector.`,
    inputSchema: {
      type: 'object',
      properties: {
        role: S.str('One role title, e.g. "Software Engineer" or "Backend Engineer"', 120),
        location: S.str('City, region or "Remote", e.g. "Bengaluru", "India" or "Remote India". Default India.', 120),
        companies: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Only these companies, by name. Default: every listed company plus the profile targets.' },
        posted_within_days: { type: 'integer', minimum: 1, maximum: 120, description: 'Only recent postings. Default 30.' },
        seniority: { type: 'string', enum: ['entry', 'mid', 'senior', 'any'], description: 'Drop listings clearly above or below this level. Default any.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Most listings to return, newest first. Default 40.' },
      },
      required: ['role'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: (args, ctx) =>
      guard(async () => {
        limit(searchCalls, ctx.tenant.userId, 'searches');
        const role = String(args.role ?? '').trim().slice(0, 120);
        if (!role) throw new ToolError('Give a role to search for.');
        const location = String(args.location ?? 'India').trim().slice(0, 120);
        const companies = Array.isArray(args.companies) ? args.companies.map((c) => String(c).trim()).filter(Boolean).slice(0, 20) : [];
        const level = ['entry', 'mid', 'senior', 'any'].includes(String(args.seniority)) ? (String(args.seniority) as 'entry') : 'any';
        const days = clampInt(args.posted_within_days, 1, 120, 30);
        const n = clampInt(args.limit, 1, 100, 40);
        const [existing, profile] = await Promise.all([
          getJobs(ctx.tenant).catch(() => []),
          getProfile(ctx.tenant).catch(() => null),
        ]);
        const r = await searchCompanySites(
          { role, location, postedWithinDays: days, seniority: level, companies },
          companiesFrom(profile?.targetCompanies ?? ''),
          existing,
        );
        return jsonResult({
          today: todayKey(),
          query: { role, location, posted_within_days: days, seniority: level, companies: companies.length ? companies : 'all listed + profile targets' },
          sites_checked: r.checked,
          matching: r.listings.length,
          listings: r.listings.slice(0, n).map((l) => ({
            role: l.role,
            company: l.company,
            location: l.location || null,
            source: l.source,
            url: l.url,
            posted_on: l.postedOn,
            seniority: l.seniority,
            already_tracked: l.alreadyTracked,
            ...(l.existingId ? { existing_id: l.existingId } : {}),
          })),
          ...(r.failed.length ? { sites_failed: r.failed.map((f) => `${f.name} (${f.ats})`) } : {}),
          ...(r.unmatched.length ? { companies_not_found: r.unmatched, hint: 'No Greenhouse, Lever or Ashby board answered for these names. They may use Workday or their own site — search the web for their careers page.' } : {}),
        });
      }),
  },

  {
    name: 'add_jobs',
    title: 'Save jobs to the tracker',
    description: `Saves jobs to the tracker (up to ${LIMITS.batch} per call). role and company are required. New jobs start as "Found" unless a status is given. Jobs the tracker already has — the same posting, or the same role at the same company in the same city — are skipped and reported, never saved twice.`,
    inputSchema: {
      type: 'object',
      properties: {
        jobs: {
          type: 'array',
          minItems: 1,
          maxItems: LIMITS.batch,
          items: {
            type: 'object',
            properties: { ...JOB_FIELD_SCHEMA, description: S.str('Short description of the role, kept in the Notion page', LIMITS.description) },
            required: ['role', 'company'],
          },
        },
      },
      required: ['jobs'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (args, ctx) =>
      guard(async () => {
        const raw = Array.isArray(args.jobs) ? args.jobs : [];
        if (!raw.length) throw new ToolError('jobs must be a non-empty list.');
        if (raw.length > LIMITS.batch) throw new ToolError(`At most ${LIMITS.batch} jobs per call — split them up.`);
        const valid: NewJob[] = [];
        const positions: number[] = [];
        const invalid: { index: number; error: string }[] = [];
        raw.forEach((j, i) => {
          const p = parseNewJob(j, { status: 'Found' });
          if (p.ok) {
            valid.push(p.value);
            positions.push(i);
          } else invalid.push({ index: i, error: p.error });
        });
        const r = await addJobs(ctx.tenant, valid, ctx.actor);
        // Report positions in the caller's list, not in the filtered one.
        const at = (i: number) => positions[i];
        return jsonResult({
          created: r.created,
          duplicates: r.duplicates.map((d) => ({ ...d, index: at(d.index) })),
          invalid,
          failed: r.errors.map((e) => ({ ...e, index: at(e.index) })),
          not_processed: r.notProcessed.map(at),
          ...(r.notProcessed.length ? { hint: 'Time ran out before every job was saved. Call add_jobs again with the ones listed in not_processed.' } : {}),
        });
      }),
  },

  {
    name: 'list_jobs',
    title: 'List tracked jobs',
    description:
      'Lists jobs in the tracker with a pipeline summary (counts per stage, response rate, follow-ups due). Filter by status, by text (company, role, location, skills) or to only the ones needing a follow-up.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          description: 'One status or a list of them',
          anyOf: [
            { type: 'string', enum: [...JOB_STATUS] },
            { type: 'array', items: { type: 'string', enum: [...JOB_STATUS] } },
          ],
        },
        query: S.str('Words to match against company, role, location and skills', 120),
        needs_follow_up: { type: 'boolean', description: 'Only jobs with a follow-up due or overdue' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Default 50' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (args, ctx) =>
      guard(async () => {
        const today = todayKey();
        const all = await getJobs(ctx.tenant);
        const statuses = (Array.isArray(args.status) ? args.status : args.status ? [args.status] : [])
          .map(coerceStatus)
          .filter((s): s is Job['status'] => s !== null);
        let jobs = args.query ? searchJobs(all, String(args.query)) : all;
        if (statuses.length) jobs = jobs.filter((j) => statuses.includes(j.status));
        if (args.needs_follow_up === true) jobs = jobs.filter((j) => followUpFor(j, today));
        const n = clampInt(args.limit, 1, 200, 50);
        const s = pipelineSummary(all, today);
        return jsonResult({
          today,
          summary: {
            total: s.total,
            by_status: Object.fromEntries(Object.entries(s.byStatus).filter(([, v]) => v > 0)),
            applied: s.applied,
            heard_back: s.heardBack,
            response_rate: Math.round(s.responseRate * 100) / 100,
            applied_last_7_days: s.appliedLast7Days,
            follow_ups_due: s.followUps.length,
          },
          matching: jobs.length,
          jobs: jobs.slice(0, n).map((j) => compactJob(j, today)),
        });
      }),
  },

  {
    name: 'get_job',
    title: 'Get one job',
    description: 'One job in full: every field, the description, and its timeline of events.',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (args, ctx) =>
      guard(async () => {
        const d = await getJob(ctx.tenant, String(args.id ?? ''));
        if (!d) throw new ToolError('No job with that id in this tracker. Use list_jobs to find it.');
        const today = todayKey();
        return jsonResult({
          today,
          job: fullJob(d.job, today),
          description: d.description.map((b) => b.text).join('\n\n') || null,
          timeline: d.timeline.map((e) => ({ date: e.date || null, kind: e.kind, text: e.text })),
        });
      }),
  },

  {
    name: 'update_job',
    title: 'Update a job',
    description:
      'Changes fields on one job. Only the fields given change; an empty string clears one. Changing status stamps Applied On and Heard Back On when it implies them, and adds a line to the timeline.',
    inputSchema: {
      type: 'object',
      properties: { id: ID, ...JOB_FIELD_SCHEMA },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (args, ctx) =>
      guard(async () => {
        const { id, ...rest } = args;
        const patch = parseJobPatch(rest);
        if (!patch.ok) throw new ToolError(patch.error);
        if (!Object.keys(patch.value).length) throw new ToolError('Give at least one field to change.');
        const job = await updateJob(ctx.tenant, String(id ?? ''), patch.value, ctx.actor);
        if (!job) throw new ToolError('No job with that id in this tracker. Use list_jobs to find it.');
        return jsonResult({ updated: Object.keys(patch.value), job: compactJob(job, todayKey()) });
      }),
  },

  {
    name: 'log_job_event',
    title: 'Log what happened',
    description:
      'Adds an event to a job\'s timeline: applied, followup (the user followed up), reply (the company answered), call, assessment, interview, rejection, offer or note. Events move the status when they imply it (interview → Interviewing, rejection → Rejected) unless move_status is false, and stamp Applied On / Heard Back On.',
    inputSchema: {
      type: 'object',
      properties: {
        id: ID,
        kind: { type: 'string', enum: [...LOGGABLE_KINDS] },
        text: S.str('What happened, briefly and factually', LIMITS.medium),
        date: S.date('When it happened. Default today'),
        move_status: { type: 'boolean', description: 'Let the event move the status. Default true.' },
      },
      required: ['id', 'kind'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: (args, ctx) =>
      guard(async () => {
        const input = parseEventInput(args);
        if (!input.ok) throw new ToolError(input.error);
        const r = await logJobEvent(ctx.tenant, String(args.id ?? ''), input.value, ctx.actor);
        if (!r) throw new ToolError('No job with that id in this tracker. Use list_jobs to find it.');
        return jsonResult({
          logged: r.event,
          moved_to: r.movedTo,
          ...(r.warning ? { warning: r.warning } : {}),
          job: compactJob(r.job, todayKey()),
        });
      }),
  },
];


export const JOB_TRACKER_SERVER: ServerDef<ToolContext> = {
  name: 'job-tracker',
  title: 'Job Switch Tracker',
  version: '1.0.0',
  instructions: INSTRUCTIONS,
  tools,
  prompts,
};
