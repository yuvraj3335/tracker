import { bearerKey } from '@/lib/api-keys';
import { tenantForApiKey } from '@/lib/tenant';
import { clientIp, createRateLimiter, retryAfterSeconds } from '@/lib/rate-limit';
import { getJobs } from '@/lib/jobs-notion';
import { BOARD_IDS, MAX_PAGE_CHARS, parseCrawl, planBoardSearch, readPostingPage, type BoardId, type CrawledPage, type LevelWanted } from '@/lib/job-search';
import { todayKey } from '@/lib/date';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const runtime = 'nodejs';
export const maxDuration = 30;

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

  const days = clamp(body.posted_within_days, 0, 30, 14);
  const boards = (Array.isArray(body.boards) ? body.boards.map(String) : BOARD_IDS).filter((b): b is BoardId =>
    (BOARD_IDS as readonly string[]).includes(b),
  );

  if (body.action === 'plan') {
    const role = String(body.role ?? '').trim().slice(0, 120);
    if (!role) return json(400, { error: 'Give a role to search for.' });
    const years = body.experience_years === undefined || body.experience_years === null ? null : clamp(body.experience_years, 0, 30, 0);
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
    return json(200, readPostingPage(url, String(body.markdown ?? '').slice(0, 50_000), typeof body.status === 'number' ? body.status : null));
  }

  return json(400, { error: 'Unknown action.' });
}

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
