/**
 * Is a posting still open? The pure half: reading posting URLs and pages.
 * Fetching lives in ./liveness-api (server) and the local connector (pages).
 *
 * Adapted from career-ops's liveness checks (liveness-core.mjs and
 * liveness-api.mjs, github.com/career-ops-hq/career-ops, MIT). The rule they
 * are built on: a wrong "closed" hides a real job for good, so only clear
 * evidence says Closed. Anything ambiguous is Unclear and gets checked again
 * later, and a page behind a bot check is Blocked — reported, never guessed.
 */
import type { PostingState } from '../schema';

export type LivenessResult = { state: PostingState; reason: string };

// ---------------------------------------------------------------------------
// Which ATS a posting URL belongs to, and the ids its API needs
// ---------------------------------------------------------------------------

export type PostingRef =
  | { ats: 'greenhouse'; board: string; id: string }
  | { ats: 'lever'; slug: string; id: string }
  | { ats: 'ashby'; org: string; id: string }
  | { ats: 'workday'; host: string; tenant: string; site: string; path: string }
  | { ats: 'smartrecruiters'; company: string; id: string }
  | { ats: 'workable'; account: string; shortcode: string };

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safe = (s: string | undefined): s is string => Boolean(s && SEGMENT.test(s));

/**
 * The API address of a posting, when its URL says which board it is on. Every
 * part is checked against a narrow pattern, because these parts end up in a
 * request the server makes: a URL saved in Notion can hold anything.
 */
export function postingRef(rawUrl: string | null | undefined): PostingRef | null {
  if (!rawUrl) return null;
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });

  // boards.greenhouse.io/{board}/jobs/{id}, job-boards.greenhouse.io/{board}/jobs/{id}.
  // The EU boards (job-boards.eu.greenhouse.io) answer on another API, so
  // they are left to a page check rather than asked of the wrong one.
  if (/^(boards|job-boards)\.greenhouse\.io$/.test(host) && parts[1] === 'jobs' && safe(parts[0]) && /^\d{4,15}$/.test(parts[2] ?? '')) {
    return { ats: 'greenhouse', board: parts[0], id: parts[2] };
  }
  // jobs.lever.co/{slug}/{uuid} — again not the EU host, for the same reason.
  if (host === 'jobs.lever.co' && safe(parts[0]) && UUID.test(parts[1] ?? '')) {
    return { ats: 'lever', slug: parts[0], id: parts[1].toLowerCase() };
  }
  // jobs.ashbyhq.com/{org}/{uuid}
  if (host === 'jobs.ashbyhq.com' && safe(parts[0]) && UUID.test(parts[1] ?? '')) {
    return { ats: 'ashby', org: parts[0], id: parts[1].toLowerCase() };
  }
  // {tenant}.wd{n}.myworkdayjobs.com/[{locale}/]{site}/job/{…path}
  const wd = /^([a-z0-9-]{1,63})\.wd\d{1,3}\.myworkdayjobs\.com$/.exec(host);
  if (wd) {
    const rest = /^[a-z]{2}-[A-Z]{2}$/.test(parts[0] ?? '') ? parts.slice(1) : parts;
    const at = rest.indexOf('job');
    // Everything from "apply" on is a step of the application, not the job:
    // …/Software-Engineer_R0123456/apply/applyManually is still R0123456.
    const after = rest.slice(at + 1);
    const cut = after.indexOf('apply');
    const path = cut >= 0 ? after.slice(0, cut) : after;
    const last = path[path.length - 1] ?? '';
    if (at === 1 && safe(rest[0]) && path.length && path.length <= 4 && path.every((p) => SEGMENT.test(p)) && /_[A-Za-z0-9-]*\d[A-Za-z0-9-]*$/.test(last)) {
      return { ats: 'workday', host, tenant: wd[1], site: rest[0], path: path.join('/') };
    }
  }
  // jobs.smartrecruiters.com/{company}/{id}[-slug]
  if (host === 'jobs.smartrecruiters.com' && safe(parts[0])) {
    const id = /^(\d{6,20})(?:-|$)/.exec(parts[1] ?? '')?.[1];
    if (id) return { ats: 'smartrecruiters', company: parts[0], id };
  }
  // apply.workable.com/{account}/j/{shortcode}
  if (host === 'apply.workable.com' && safe(parts[0]) && parts[1] === 'j' && /^[A-Za-z0-9]{6,16}$/.test(parts[2] ?? '')) {
    return { ats: 'workable', account: parts[0], shortcode: parts[2].toUpperCase() };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading a posting page
// ---------------------------------------------------------------------------

/** Curly quotes and accents out, whitespace squeezed, lowercase: what the patterns below expect. */
export function normalizePage(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

const BOT_CHECK = /\b(just a moment|verify you are (a )?human|checking your browser|enable javascript and cookies|are you a robot|press (and|&) hold|unusual traffic|attention required|captcha|request blocked|access denied)\b|\bray id\b|humans only/;
/** A sign-in wall is not a closed job: it is a page the connector may not read. */
const SIGN_IN = /\b(sign in to (view|see|continue|apply)|log in to (view|see|continue|apply)|join linkedin|authwall|create an account to (view|see|continue))\b/;

/**
 * Banners that mean the job is gone. Each is a whole statement about the
 * posting: "no longer accepting applications", not "not open to recruitment
 * agencies"; "applications are closed." at the end of a sentence, not
 * "applications are closed once we find the right person". A date alone ("closes
 * on 2 Oct") is never read, because it is as often a future deadline.
 */
const CLOSED: RegExp[] = [
  /\bno longer accepting (applications|candidates)\b/,
  /\b(this|the) (job|position|role|posting|vacancy|opening|requisition) (is )?no longer (available|open|active|accepting)/,
  /\b(this|the) (job|position|posting|vacancy|opening|requisition) is not available( anymore| any more)?(?=[.!]|$)/,
  /\b(job|position|posting|vacancy|opening) (has )?(expired|been closed|been removed)(?=[.!,]|$| and )/,
  /\b(position|role|vacancy|job) (has been|was) filled(?=[.!]|$)/,
  /\b(this|the) (job|role|position|posting) (is|has been|was) closed(?=[.!]|$)/,
  /\bapplications (are |have )?(now )?closed(?=[.!]|$)/,
  /\b(job|posting|page) (was )?not found(?=[.!]|$)/,
  /\bthe job you are (looking for|trying to apply for) (is )?(no longer|not) (available|open)/,
];

const APPLY_CONTROL = /\b(apply now|apply for this (job|position|role)|easy apply|submit (your )?application|start (your )?application|apply)\b/;

/** Banners are read near the top: a "similar jobs" list further down says nothing about this one. */
const TOP = 4000;

/**
 * What a crawled posting page says about the job. In order: gone by status,
 * blocked by a bot check or a sign-in wall, gone by a closed-job redirect or
 * a closed banner with no way to apply beside it, still listed if there is a
 * way to apply, and otherwise unclear.
 *
 * Deliberately short on Closed. A nearly empty page, a list of jobs, or a
 * banner next to an apply button are all Unclear: an app that had not drawn
 * yet, a site that moved its jobs, and a page with a closed banner for some
 * other role all look like that, and a wrong Closed hides a real job.
 */
export function pageVerdict(p: {
  status: number | null;
  requestedUrl: string;
  finalUrl: string | null;
  text: string;
  rendered: boolean;
}): LivenessResult {
  const text = normalizePage(p.text).slice(0, 60_000);
  const top = text.slice(0, TOP);
  if (p.status === 404 || p.status === 410) return { state: 'Closed', reason: `the page answers ${p.status}` };
  if (BOT_CHECK.test(top)) return { state: 'Blocked', reason: 'the site showed a bot check' };
  if (SIGN_IN.test(top)) return { state: 'Blocked', reason: 'the site asked to sign in' };
  if (p.status === 401 || p.status === 403 || p.status === 429 || p.status === 503) return { state: 'Blocked', reason: `the site answered ${p.status}` };
  if (p.status !== null && p.status >= 500) return { state: 'Unclear', reason: `the site answered ${p.status}` };

  const final = p.finalUrl ?? p.requestedUrl;
  if (/[?&]error=true\b/.test(final)) return { state: 'Closed', reason: 'redirected to a closed-job page' };

  // A job id that vanished from the address is a redirect to the listing — or
  // a site that moved its jobs. Not proof either way.
  const idIn = (u: string) => /[0-9a-f]{8}-[0-9a-f]{4}-|\d{5,}/i.exec(u)?.[0] ?? null;
  const asked = idIn(p.requestedUrl);
  if (asked && !final.includes(asked)) return { state: 'Unclear', reason: 'the link now goes somewhere else' };

  const banner = CLOSED.find((re) => re.test(top));
  const canApply = APPLY_CONTROL.test(top);
  if (banner && !canApply) return { state: 'Closed', reason: `the page says: “${top.match(banner)![0]}”` };
  if (banner) return { state: 'Unclear', reason: 'the page says closed but still shows a way to apply' };
  if (canApply) return { state: 'Open', reason: 'the page is up with a way to apply' };
  if (text.length < 300) return { state: 'Unclear', reason: 'the page was nearly empty — it may not have finished loading' };
  return { state: 'Unclear', reason: 'the page did not say either way' };
}
