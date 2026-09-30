/**
 * When two postings are the same posting.
 *
 * The same job arrives more than once — from two searches, two AI tools, or one
 * posting cross-listed on LinkedIn and Naukri — and must be recognised as one.
 */
import { normalize } from '../search';
import { daysBetween, type DayKey } from '../date';
import type { Job, JobFields } from './model';

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
// Reposts
// ---------------------------------------------------------------------------

export const REPOST_WINDOW_DAYS = 90;

/** A board's own posting id — not a cleaned URL, not a role signature. */
const boardId = (k: string | null | undefined) => (k && !k.startsWith('url:') && !k.startsWith('sig:') ? k : null);

/**
 * A duplicate by role, company and city that is really the company posting the
 * job again: the same board, a new posting id, first seen on a different day
 * within 90 days. The rule is career-ops's (detect-reposts.mjs), including its
 * care about same-day copies — two same-title openings posted the same day are
 * two openings, not a repost. A repost is worth knowing: a job that keeps
 * coming back is either hard to fill or not really being filled.
 */
export function isRepost(
  candidate: Pick<JobFields, 'jobUrl' | 'applyUrl' | 'source'>,
  existing: Pick<Job, 'key' | 'jobUrl' | 'applyUrl' | 'source' | 'foundOn'>,
  today: DayKey,
): boolean {
  if (!existing.foundOn || existing.foundOn === today) return false;
  if (daysBetween(existing.foundOn, today) > REPOST_WINDOW_DAYS) return false;
  if (!candidate.source || candidate.source !== existing.source) return false;
  const mine = boardId(postingKey(candidate.jobUrl)) ?? boardId(postingKey(candidate.applyUrl));
  const theirs = boardId(existing.key) ?? boardId(postingKey(existing.jobUrl)) ?? boardId(postingKey(existing.applyUrl));
  return Boolean(mine && theirs && mine !== theirs);
}
