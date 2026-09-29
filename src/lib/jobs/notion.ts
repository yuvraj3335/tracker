/**
 * Job applications in the user's own Notion: every read and write.
 *
 * The tracker's pages and the AI tools' API both come through here, so there
 * is one place that knows the schema, one place that stamps dates, and one
 * place that refuses duplicates. Like the rest of the app, every function takes
 * a Tenant explicitly — there is no ambient token.
 */
import { Client } from '@notionhq/client';
import { P, type AddedBy, type JobStatus } from '../schema';
import { callerFor, type Caller } from '../provision';
import { claimJobsLease, releaseJobsLease } from '../db';
import { todayKey, type DayKey } from '../date';
import {
  EMPTY_PROFILE,
  EVENT_LABEL,
  dedupeKey,
  findDuplicate,
  formatEvent,
  isHeardBack,
  parseEvent,
  stampsFor,
  statusAfterEvent,
  textRuns,
  type EventInput,
  type Job,
  type JobEvent,
  type JobFields,
  type JobPatch,
  type JobProfile,
  type NewJob,
} from '.';
import type { Tenant } from '../tenant';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Retries are left to `callerFor`, which backs off for a second or two. The
 * SDK's own retry honours Retry-After up to a minute, which inside a
 * serverless function answering an AI tool is a request that simply times out.
 */
const clients = new Map<string, Client>();
export function clientFor(token: string): Client {
  let c = clients.get(token);
  if (!c) {
    c = new Client({ auth: token, retry: false, timeoutMs: 20_000 });
    clients.set(token, c);
    if (clients.size > 200) clients.delete(clients.keys().next().value!);
  }
  return c;
}

/** Reads retry like writes, but skip the write queue — see callerFor. */
const readerFor = (token: string) => callerFor(token, { throttle: false });

/** Who made a change. Lands on the row as Added By and in the timeline. */
export type Actor = { kind: AddedBy; name: string };

export class JobsError extends Error {
  constructor(
    message: string,
    readonly code: 'not_set_up' | 'not_found' | 'busy' | 'no_parent',
  ) {
    super(message);
  }
}

export const NOT_SET_UP =
  'Job tracking is not set up for this account yet. Open the tracker, go to Jobs and choose “Set up job tracking”.';

const ID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
export const isNotionId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v.trim());
const sameId = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.replace(/-/g, '').toLowerCase() === b.replace(/-/g, '').toLowerCase());

// ---------------------------------------------------------------------------
// Property reading
// ---------------------------------------------------------------------------
const rt = (p: any): string => (p?.rich_text ?? []).map((t: any) => t?.plain_text ?? '').join('').trim();
const tt = (p: any): string => (p?.title ?? []).map((t: any) => t?.plain_text ?? '').join('').trim();
const nm = (p: any): number | null => (typeof p?.number === 'number' ? p.number : null);
const sel = (p: any): string | null => p?.select?.name ?? null;
const msel = (p: any): string[] => (p?.multi_select ?? []).map((o: any) => o?.name).filter(Boolean);
const dt = (p: any): DayKey | null => (typeof p?.date?.start === 'string' ? p.date.start.slice(0, 10) : null);
const ur = (p: any): string | null => (typeof p?.url === 'string' && p.url ? p.url : null);

export function mapJob(page: any): Job {
  const p = page.properties ?? {};
  return {
    id: page.id,
    role: tt(p[P.job.role]),
    company: rt(p[P.job.company]),
    status: (sel(p[P.job.status]) as JobStatus | null) ?? 'Found',
    source: (sel(p[P.job.source]) as Job['source']) ?? null,
    location: rt(p[P.job.location]),
    workMode: (sel(p[P.job.workMode]) as Job['workMode']) ?? null,
    jobUrl: ur(p[P.job.jobUrl]),
    applyUrl: ur(p[P.job.applyUrl]),
    match: nm(p[P.job.match]),
    fit: rt(p[P.job.fit]),
    howToApply: rt(p[P.job.howToApply]),
    salary: rt(p[P.job.salary]),
    experience: rt(p[P.job.experience]),
    skills: msel(p[P.job.skills]),
    postedOn: dt(p[P.job.postedOn]),
    appliedOn: dt(p[P.job.appliedOn]),
    appliedVia: (sel(p[P.job.appliedVia]) as Job['appliedVia']) ?? null,
    resume: rt(p[P.job.resume]),
    referral: rt(p[P.job.referral]),
    contact: rt(p[P.job.contact]),
    nextStep: rt(p[P.job.nextStep]),
    followUpOn: dt(p[P.job.followUpOn]),
    notes: rt(p[P.job.notes]),
    foundOn: dt(p[P.job.foundOn]),
    lastUpdate: dt(p[P.job.lastUpdate]),
    heardBackOn: dt(p[P.job.heardBackOn]),
    addedBy: (sel(p[P.job.addedBy]) as AddedBy | null) ?? null,
    key: rt(p[P.job.key]),
    notionUrl: typeof page.url === 'string' ? page.url : '',
    createdAt: typeof page.created_time === 'string' ? page.created_time : '',
  };
}

// ---------------------------------------------------------------------------
// Property writing
// ---------------------------------------------------------------------------
const runs = (s: string) => textRuns(s).map((content) => ({ type: 'text' as const, text: { content } }));
const selectOf = (v: string | null | undefined) => ({ select: v ? { name: v } : null });
const dateOf = (v: string | null | undefined) => ({ date: v ? { start: v } : null });

type Writable = Partial<
  JobFields & Pick<Job, 'foundOn' | 'lastUpdate' | 'heardBackOn' | 'addedBy' | 'key'>
>;

/** Notion property values for exactly the keys present. */
export function jobProperties(f: Writable): Record<string, any> {
  const out: Record<string, any> = {};
  const set = (k: keyof Writable, prop: string, value: () => any) => {
    if (k in f) out[prop] = value();
  };
  set('role', P.job.role, () => ({ title: runs(f.role ?? '') }));
  for (const [k, prop] of [
    ['company', P.job.company],
    ['location', P.job.location],
    ['fit', P.job.fit],
    ['howToApply', P.job.howToApply],
    ['salary', P.job.salary],
    ['experience', P.job.experience],
    ['resume', P.job.resume],
    ['referral', P.job.referral],
    ['contact', P.job.contact],
    ['nextStep', P.job.nextStep],
    ['notes', P.job.notes],
    ['key', P.job.key],
  ] as const) {
    set(k, prop, () => ({ rich_text: runs(String(f[k] ?? '')) }));
  }
  for (const [k, prop] of [
    ['status', P.job.status],
    ['source', P.job.source],
    ['workMode', P.job.workMode],
    ['appliedVia', P.job.appliedVia],
    ['addedBy', P.job.addedBy],
  ] as const) {
    set(k, prop, () => selectOf(f[k] as string | null));
  }
  set('jobUrl', P.job.jobUrl, () => ({ url: f.jobUrl ?? null }));
  set('applyUrl', P.job.applyUrl, () => ({ url: f.applyUrl ?? null }));
  set('match', P.job.match, () => ({ number: f.match ?? null }));
  set('skills', P.job.skills, () => ({ multi_select: (f.skills ?? []).map((name) => ({ name })) }));
  for (const [k, prop] of [
    ['postedOn', P.job.postedOn],
    ['appliedOn', P.job.appliedOn],
    ['followUpOn', P.job.followUpOn],
    ['foundOn', P.job.foundOn],
    ['lastUpdate', P.job.lastUpdate],
    ['heardBackOn', P.job.heardBackOn],
  ] as const) {
    set(k, prop, () => dateOf(f[k] as string | null));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Page body: description and timeline
// ---------------------------------------------------------------------------
const TIMELINE = 'Timeline';
const ABOUT = 'About the role';

const heading = (text: string) => ({
  object: 'block',
  type: 'heading_2',
  heading_2: { rich_text: runs(text) },
});
const paragraph = (text: string) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: runs(text) } });
export const eventBlock = (e: JobEvent) => ({
  object: 'block',
  type: 'bulleted_list_item',
  bulleted_list_item: { rich_text: runs(formatEvent(e)) },
});

/**
 * The body a new job page starts with. Paragraphs are split on blank lines and
 * capped, because Notion takes at most 100 blocks in one create.
 */
export function initialBody(description: string, first: JobEvent): any[] {
  const blocks: any[] = [];
  const paras = description
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 60);
  if (paras.length) {
    blocks.push(heading(ABOUT));
    for (const p of paras) blocks.push(paragraph(p));
  }
  blocks.push(heading(TIMELINE));
  blocks.push(eventBlock(first));
  return blocks;
}

export type BodyBlock = { type: 'heading' | 'paragraph' | 'bullet' | 'todo' | 'quote' | 'code'; text: string; checked?: boolean };

const blockText = (b: any): string => {
  const inner = b?.[b?.type];
  return (inner?.rich_text ?? []).map((t: any) => t?.plain_text ?? '').join('');
};

/**
 * Splits a page body into the description and the timeline.
 *
 * Everything under the "Timeline" heading is read as events; everything else is
 * kept as description, in order. Blocks the app never writes (images, embeds,
 * tables someone added by hand in Notion) are skipped rather than failing the
 * page — they are still there in Notion.
 */
export function splitBody(blocks: readonly any[]): { description: BodyBlock[]; timeline: JobEvent[] } {
  const description: BodyBlock[] = [];
  const timeline: JobEvent[] = [];
  let inTimeline = false;
  for (const b of blocks) {
    const text = blockText(b).trim();
    const type = b?.type;
    if (type === 'heading_1' || type === 'heading_2' || type === 'heading_3') {
      inTimeline = text.toLowerCase() === TIMELINE.toLowerCase();
      if (!inTimeline && text.toLowerCase() !== ABOUT.toLowerCase() && text) {
        description.push({ type: 'heading', text });
      }
      continue;
    }
    if (!text) continue;
    if (inTimeline) {
      const e = parseEvent(text);
      if (e) timeline.push(e);
      continue;
    }
    if (type === 'paragraph') description.push({ type: 'paragraph', text });
    else if (type === 'bulleted_list_item' || type === 'numbered_list_item') description.push({ type: 'bullet', text });
    else if (type === 'to_do') description.push({ type: 'todo', text, checked: b.to_do?.checked === true });
    else if (type === 'quote' || type === 'callout') description.push({ type: 'quote', text });
    else if (type === 'code') description.push({ type: 'code', text });
  }
  return { description, timeline };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * A short cache of each tenant's job list.
 *
 * Shorter than the task cache on purpose: the point of this section is that an
 * AI tool adds jobs and you then look at them, and a minute-old list would hide
 * exactly the rows you came to see. Keyed by user id, never shared.
 */
const JOBS_TTL_MS = 15_000;
const listCache = new Map<string, { at: number; jobs: Job[] }>();

export function invalidateJobs(userId: string) {
  listCache.delete(userId);
}

function requireJobs(t: Tenant): string {
  if (!t.jobsDs) throw new JobsError(NOT_SET_UP, 'not_set_up');
  return t.jobsDs;
}

export async function getJobs(t: Tenant, opts: { fresh?: boolean } = {}): Promise<Job[]> {
  const ds = requireJobs(t);
  const hit = listCache.get(t.userId);
  if (!opts.fresh && hit && Date.now() - hit.at < JOBS_TTL_MS) return hit.jobs;
  // Paged by hand so each page goes through the caller, which retries a 429 —
  // this client has the SDK's own retry off.
  const run = readerFor(t.token);
  const rows: any[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 20; guard++) {
    const res: any = await run('list jobs', () =>
      clientFor(t.token).dataSources.query({
        data_source_id: ds,
        page_size: 100,
        start_cursor: cursor,
        sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      } as any),
    );
    rows.push(...(res.results ?? []));
    if (!res.has_more) break;
    cursor = res.next_cursor ?? undefined;
  }
  const jobs = rows.map(mapJob);
  listCache.set(t.userId, { at: Date.now(), jobs });
  if (listCache.size > 400) listCache.delete(listCache.keys().next().value!);
  return jobs;
}

/**
 * One job's page, or null when it is not one of this tenant's jobs.
 *
 * Ids arrive from the browser and from AI tools, so the parent is checked: the
 * token already confines a request to that person's workspace, but without
 * this a job id could name any page in it — a DSA question, say — and the jobs
 * API would happily edit it.
 */
async function jobPage(t: Tenant, run: Caller, id: string): Promise<any | null> {
  const ds = requireJobs(t);
  if (!isNotionId(id)) return null;
  let page: any;
  try {
    page = await run('read job', () => clientFor(t.token).pages.retrieve({ page_id: id.trim() }));
  } catch (e) {
    const cause = (e as any)?.cause ?? e;
    if (cause?.status === 404 || cause?.code === 'object_not_found' || cause?.code === 'validation_error') return null;
    throw e;
  }
  if (page?.in_trash || page?.archived) return null;
  if (!sameId(page?.parent?.data_source_id, ds)) return null;
  return page;
}

export type JobDetail = { job: Job; description: BodyBlock[]; timeline: JobEvent[] };

async function readBody(t: Tenant, run: Caller, pageId: string): Promise<any[]> {
  const blocks: any[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 3; i++) {
    const res: any = await run('read job body', () =>
      clientFor(t.token).blocks.children.list({ block_id: pageId, page_size: 100, start_cursor: cursor }),
    );
    blocks.push(...(res.results ?? []));
    if (!res.has_more) break;
    cursor = res.next_cursor ?? undefined;
  }
  return blocks;
}

/**
 * One job with its description and timeline. The page and its body are read
 * at the same time; the body is thrown away unless the page turns out to be
 * one of this tenant's jobs, so the ownership check costs no extra wait.
 */
export async function getJob(t: Tenant, id: string): Promise<JobDetail | null> {
  if (!isNotionId(id)) return null;
  const run = readerFor(t.token);
  const [page, blocks] = await Promise.all([
    jobPage(t, run, id),
    readBody(t, run, id.trim()).catch(() => null),
  ]);
  if (!page) return null;
  return { job: mapJob(page), ...splitBody(blocks ?? (await readBody(t, run, page.id))) };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type AddResult = {
  created: { id: string; role: string; company: string; notionUrl: string }[];
  duplicates: { index: number; role: string; company: string; existingId: string; reason: string }[];
  /** Left for the next call when the time budget ran out. */
  notProcessed: number[];
  errors: { index: number; error: string }[];
};

/**
 * Adds jobs, skipping any that are already tracked.
 *
 * Duplicates are checked against a fresh read, not the cache — the cache is
 * exactly what would miss a row another tool added seconds ago — and against
 * the batch itself, since one search often finds a posting twice. The lease
 * makes the check-then-write safe against a second batch arriving at once.
 *
 * Writes are paced by `callerFor` (~3 a second) and bounded by `budgetMs`, so a
 * big batch stops cleanly inside the function's time limit and says which rows
 * it did not reach instead of being killed halfway through one.
 */
export async function addJobs(
  t: Tenant,
  jobs: readonly NewJob[],
  actor: Actor,
  opts: { budgetMs?: number } = {},
): Promise<AddResult> {
  const ds = requireJobs(t);
  const started = Date.now();
  const budget = opts.budgetMs ?? 40_000;
  const result: AddResult = { created: [], duplicates: [], notProcessed: [], errors: [] };
  if (!jobs.length) return result;

  if (!(await claimJobsLease(t.userId))) {
    throw new JobsError('Another update to your jobs is still running. Try again in a few seconds.', 'busy');
  }
  try {
    const existing: Pick<Job, 'id' | 'key' | 'jobUrl' | 'applyUrl' | 'company' | 'role' | 'location'>[] = [
      ...(await getJobs(t, { fresh: true })),
    ];
    const run = callerFor(t.token);
    const today = todayKey();

    for (let i = 0; i < jobs.length; i++) {
      if (Date.now() - started > budget) {
        for (let j = i; j < jobs.length; j++) result.notProcessed.push(j);
        break;
      }
      const job = jobs[i];
      const dup = findDuplicate(job, existing);
      if (dup) {
        result.duplicates.push({ index: i, role: job.role, company: job.company, existingId: dup.id, reason: dup.reason });
        continue;
      }
      const key = dedupeKey(job);
      const stamps = stampsFor({ appliedOn: job.appliedOn, heardBackOn: null }, job.status, today);
      const first: JobEvent =
        job.status === 'Found'
          ? { date: today, kind: 'found', text: `on ${job.source ?? 'the web'}, added by ${actor.name}` }
          : { date: today, kind: 'status', text: `added as ${job.status} by ${actor.name}` };
      try {
        const page: any = await run('add job', () =>
          clientFor(t.token).pages.create({
            parent: { type: 'data_source_id', data_source_id: ds },
            properties: jobProperties({
              ...job,
              ...stamps,
              foundOn: today,
              lastUpdate: today,
              addedBy: actor.kind,
              key,
            }),
            children: initialBody(job.description, first),
          } as any),
        );
        result.created.push({ id: page.id, role: job.role, company: job.company, notionUrl: page.url ?? '' });
        existing.push({ id: page.id, key, jobUrl: job.jobUrl, applyUrl: job.applyUrl, company: job.company, role: job.role, location: job.location });
      } catch (e) {
        result.errors.push({ index: i, error: (e as Error).message });
      }
    }
  } finally {
    await releaseJobsLease(t.userId);
    invalidateJobs(t.userId);
  }
  return result;
}

/**
 * Changes fields on a job. A status change stamps what it implies (Applied On,
 * Heard Back On) and adds a line to the timeline; everything stamps Last
 * Update. Returns null when the job is not this tenant's.
 */
export async function updateJob(t: Tenant, id: string, patch: JobPatch, actor: Actor): Promise<Job | null> {
  const run = callerFor(t.token);
  const page = await jobPage(t, run, id);
  if (!page) return null;
  const current = mapJob(page);
  const today = todayKey();

  const next: Writable = { ...patch, lastUpdate: today };
  const moved = patch.status && patch.status !== current.status ? patch.status : null;
  if (moved) {
    const stamps = stampsFor(
      { appliedOn: patch.appliedOn ?? current.appliedOn, heardBackOn: current.heardBackOn },
      moved,
      today,
    );
    Object.assign(next, stamps);
  }
  // The posting's identity changes with its link, so the stored key follows.
  if ('jobUrl' in patch || 'applyUrl' in patch || 'role' in patch || 'company' in patch || 'location' in patch) {
    next.key = dedupeKey({ ...current, ...patch });
  }

  const updated: any = await run('update job', () =>
    clientFor(t.token).pages.update({ page_id: page.id, properties: jobProperties(next) } as any),
  );
  if (moved) {
    await appendEvent(t, run, page.id, {
      date: today,
      kind: 'status',
      text: `${current.status} → ${moved}${actor.kind === 'AI' ? ` (by ${actor.name})` : ''}`,
    }).catch(() => undefined);
  }
  invalidateJobs(t.userId);
  return mapJob(updated);
}

async function appendEvent(t: Tenant, run: Caller, pageId: string, e: JobEvent) {
  await run('add timeline entry', () =>
    clientFor(t.token).blocks.children.append({ block_id: pageId, children: [eventBlock(e)] } as any),
  );
}

export type LogResult = { job: Job; event: JobEvent; movedTo: JobStatus | null; warning?: string };

/**
 * Adds a timeline entry — "applied through a referral", "OA link arrived",
 * "rejected after round 2" — and moves the status when the event implies it.
 *
 * Properties first, then the entry: if the append then fails the status is
 * still right and the caller is told, rather than a line claiming a move that
 * never happened.
 */
export async function logJobEvent(t: Tenant, id: string, input: EventInput, actor: Actor): Promise<LogResult | null> {
  const run = callerFor(t.token);
  const page = await jobPage(t, run, id);
  if (!page) return null;
  const current = mapJob(page);
  const today = todayKey();
  const date = input.date ?? today;

  const props: Writable = { lastUpdate: today };
  if (isHeardBack(input.kind) && !current.heardBackOn) props.heardBackOn = date;
  if (input.kind === 'applied' && !current.appliedOn) props.appliedOn = date;
  const movedTo = input.moveStatus ? statusAfterEvent(current.status, input.kind) : null;
  if (movedTo) {
    props.status = movedTo;
    Object.assign(
      props,
      stampsFor(
        { appliedOn: props.appliedOn ?? current.appliedOn, heardBackOn: props.heardBackOn ?? current.heardBackOn },
        movedTo,
        date,
      ),
    );
  }

  const updated: any = await run('update job', () =>
    clientFor(t.token).pages.update({ page_id: page.id, properties: jobProperties(props) } as any),
  );
  const by = actor.kind === 'AI' ? ` (by ${actor.name})` : '';
  const event: JobEvent = {
    date,
    kind: input.kind,
    text: [input.text, movedTo ? `moved to ${movedTo}` : ''].filter(Boolean).join(' · ') + by,
  };
  let warning: string | undefined;
  try {
    await appendEvent(t, run, page.id, event);
  } catch {
    warning = `Saved, but the ${EVENT_LABEL[input.kind].toLowerCase()} entry could not be added to the timeline.`;
  }
  invalidateJobs(t.userId);
  return { job: mapJob(updated), event, movedTo, warning };
}

/** Moves a job to Notion's trash, where it can still be restored for 30 days. */
export async function trashJob(t: Tenant, id: string): Promise<boolean> {
  const run = callerFor(t.token);
  const page = await jobPage(t, run, id);
  if (!page) return false;
  await run('remove job', () => clientFor(t.token).pages.update({ page_id: page.id, in_trash: true } as any));
  invalidateJobs(t.userId);
  return true;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

const PROFILE_TEXT: [keyof JobProfile, string][] = [
  ['targetRoles', P.profile.targetRoles],
  ['experience', P.profile.experience],
  ['locations', P.profile.locations],
  ['skills', P.profile.skills],
  ['salary', P.profile.salary],
  ['noticePeriod', P.profile.noticePeriod],
  ['mustHaves', P.profile.mustHaves],
  ['dealBreakers', P.profile.dealBreakers],
  ['targetCompanies', P.profile.targetCompanies],
  ['avoidCompanies', P.profile.avoidCompanies],
  ['resume', P.profile.resume],
];

export function mapProfile(page: any): JobProfile & { updatedAt: string | null } {
  const p = page?.properties ?? {};
  const out: JobProfile = { ...EMPTY_PROFILE };
  for (const [k, prop] of PROFILE_TEXT) (out as Record<string, unknown>)[k] = rt(p[prop]);
  out.workModes = msel(p[P.profile.workModes]) as JobProfile['workModes'];
  return { ...out, updatedAt: typeof page?.last_edited_time === 'string' ? page.last_edited_time : null };
}

export async function getProfile(t: Tenant): Promise<(JobProfile & { updatedAt: string | null }) | null> {
  requireJobs(t);
  if (!t.jobsProfilePageId) return null;
  const page: any = await readerFor(t.token)('read profile', () =>
    clientFor(t.token).pages.retrieve({ page_id: t.jobsProfilePageId! }),
  );
  return mapProfile(page);
}

export async function saveProfile(t: Tenant, profile: Partial<JobProfile>): Promise<JobProfile & { updatedAt: string | null }> {
  requireJobs(t);
  if (!t.jobsProfilePageId) throw new JobsError(NOT_SET_UP, 'not_set_up');
  const properties: Record<string, any> = {};
  for (const [k, prop] of PROFILE_TEXT) {
    if (k in profile) properties[prop] = { rich_text: runs(String(profile[k] ?? '')) };
  }
  if ('workModes' in profile) {
    properties[P.profile.workModes] = { multi_select: (profile.workModes ?? []).map((name) => ({ name })) };
  }
  const page: any = await callerFor(t.token)('save profile', () =>
    clientFor(t.token).pages.update({ page_id: t.jobsProfilePageId!, properties } as any),
  );
  return mapProfile(page);
}
