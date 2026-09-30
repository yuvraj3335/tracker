import { bearerKey } from '@/lib/api-keys';
import { tenantForApiKey } from '@/lib/tenant';
import { clientIp, createRateLimiter, retryAfterSeconds } from '@/lib/rate-limit';
import { NOT_SET_UP, getJobs, recordPostingChecks, type PostingCheck } from '@/lib/jobs/notion';
import { BOARD_IDS, MAX_PAGE_CHARS, parseCrawl, planBoardSearch, readPostingPage, type BoardId, type CrawledPage, type LevelWanted } from '@/lib/job-search';
import { pageVerdict } from '@/lib/job-search/liveness';
import { todayKey } from '@/lib/date';
import { clampInt } from '@/lib/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The tracker's half of a job-board search, for the Job Hunt connector.
 *
 * The connector runs on the user's computer next to Crawl4AI, which this
 * server cannot reach, so it drives the search: it asks here which pages to
 * open (`plan`), opens them with Crawl4AI, and sends the rendered pages back
 * to be read (`parse`, `posting`). Keeping both ends here means the knowledge
 * of each board — its URLs and the shape of its pages — lives in one tested
 * place, and the connector stays a courier.
 *
 * Authenticated by the same personal key as the MCP endpoint; the proxy lets
 * this route skip the session cookie.
 */
/** Per account, not per key — see mcp-http.ts. */
const perAccount = createRateLimiter(120, 5 * 60_000);
const failedAuth = createRateLimiter(30, 5 * 60_000);
const MAX_BODY = 3_000_000;
const LEVELS: LevelWanted[] = ['entry', 'mid', 'senior', 'any'];

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

export async function POST(req: Request) {
  const fails = () => {
    const r = failedAuth(clientIp(req));
    return r.allowed ? null : json(429, { error: 'Too many failed attempts. Try again later.' }, { 'retry-after': String(retryAfterSeconds(r.retryAfterMs)) });
  };
  const key = bearerKey(req.headers.get('authorization'));
  if (!key) return fails() ?? json(401, { error: 'Missing key. Save your personal key for the connector (Jobs → Connect AI).' });
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return json(413, { error: 'Too much page content in one request.' });
  const who = await tenantForApiKey(key);
  if (!who.ok) return (who.status === 401 ? fails() : null) ?? json(who.status, { error: who.message });

  const rate = perAccount(who.tenant.userId);
  if (!rate.allowed) {
    return json(429, { error: 'Too many searches for now.' }, { 'retry-after': String(retryAfterSeconds(rate.retryAfterMs)) });
  }

  const text = await req.text();
  if (text.length > MAX_BODY) return json(413, { error: 'Too much page content in one request.' });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: 'Bad JSON.' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Send a JSON object.' });

  const days = clampInt(body.posted_within_days, 0, 30, 14);
  const boards = (Array.isArray(body.boards) ? body.boards.map(String) : BOARD_IDS).filter((b): b is BoardId =>
    (BOARD_IDS as readonly string[]).includes(b),
  );

  if (body.action === 'plan') {
    const role = String(body.role ?? '').trim().slice(0, 120);
    if (!role) return json(400, { error: 'Give a role to search for.' });
    const years = body.experience_years === undefined || body.experience_years === null ? null : clampInt(body.experience_years, 0, 30, 0);
    return json(200, {
      pages: planBoardSearch(
        { role, location: String(body.location ?? 'India').slice(0, 120), postedWithinDays: days, minYears: years },
        boards,
      ),
    });
  }

  if (body.action === 'parse') {
    const pages: CrawledPage[] = (Array.isArray(body.pages) ? body.pages : []).slice(0, 12).map((p: any) => ({
      board: String(p?.board ?? '') as BoardId,
      url: String(p?.url ?? ''),
      markdown: String(p?.markdown ?? '').slice(0, MAX_PAGE_CHARS),
      items: Array.isArray(p?.items) ? p.items.slice(0, 200) : null,
      status: typeof p?.status === 'number' ? p.status : null,
      error: p?.error ? String(p.error).slice(0, 300) : null,
    }));
    const seniority = LEVELS.includes(body.seniority as LevelWanted) ? (body.seniority as LevelWanted) : 'any';
    // Duplicates are marked, not dropped — the model decides — so a tracker
    // that is not set up for jobs yet still gets its results.
    const existing = who.tenant.jobsDs ? await getJobs(who.tenant).catch(() => []) : [];
    const location = String(body.location ?? 'India').slice(0, 120);
    return json(200, { today: todayKey(), ...parseCrawl(pages, { seniority, postedWithinDays: days, location }, existing) });
  }

  if (body.action === 'posting') {
    const url = String(body.url ?? '');
    const markdown = String(body.markdown ?? '').slice(0, 50_000);
    const status = typeof body.status === 'number' ? body.status : null;
    const live = pageVerdict({ status, requestedUrl: url, finalUrl: typeof body.final_url === 'string' ? body.final_url : null, text: markdown, rendered: true });
    return json(200, { ...readPostingPage(url, markdown, status), posting_state: live.state, posting_reason: live.reason });
  }

  // Posting pages the connector read for jobs with no posting API: each is
  // read here the same way, and recorded on the job. Ids are looked up in this
  // account's own list first — that is the ownership check — and the page is
  // judged against the link stored on the job, not one the request names.
  if (body.action === 'liveness') {
    if (!who.tenant.jobsDs) return json(400, { error: NOT_SET_UP });
    const bare = (id: unknown) => String(id ?? '').replace(/-/g, '').toLowerCase();
    const pages = (Array.isArray(body.pages) ? body.pages : [])
      .filter((p: any, i: number, all: any[]) => all.findIndex((q) => bare(q?.id) === bare(p?.id)) === i)
      .slice(0, 8);
    const jobs = await getJobs(who.tenant, { fresh: true });
    const checks: PostingCheck[] = [];
    const results: { id: string; job?: string; state?: string; reason?: string; error?: string }[] = [];
    for (const p of pages) {
      const job = jobs.find((j) => bare(j.id) === bare(p?.id));
      if (!job) {
        results.push({ id: String(p?.id ?? '').slice(0, 40), error: 'not one of your jobs' });
        continue;
      }
      const v = p?.error
        ? { state: 'Unclear' as const, reason: `the page did not load: ${String(p.error).slice(0, 120)}` }
        : pageVerdict({
            status: typeof p?.status === 'number' ? p.status : null,
            requestedUrl: job.jobUrl ?? job.applyUrl ?? '',
            finalUrl: typeof p?.final_url === 'string' ? p.final_url.slice(0, 2000) : null,
            text: String(p?.markdown ?? '').slice(0, 50_000),
            rendered: true,
          });
      checks.push({ job, state: v.state, reason: v.reason });
      results.push({ id: job.id, job: `${job.role} at ${job.company}`, state: v.state, reason: v.reason });
    }
    const saved = await recordPostingChecks(who.tenant, checks);
    return json(200, { today: todayKey(), results, ...(saved.errors.length ? { not_saved: saved.errors } : {}) });
  }

  return json(400, { error: 'Unknown action.' });
}
