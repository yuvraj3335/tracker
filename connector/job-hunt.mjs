#!/usr/bin/env node
/**
 * Job Hunt connector — one MCP server for every AI tool on this computer.
 *
 * Claude Code, Codex, Gemini CLI, Cursor and Claude Desktop all run local MCP
 * servers the same way: they start a process and talk JSON-RPC over its
 * stdin/stdout. This is that process. It joins two things no single place can:
 *
 *   - the tracker (on Vercel), which holds your jobs, profile and timeline,
 *     reached over HTTPS with your personal key; and
 *   - Crawl4AI, running in Docker on this computer, which is the only thing
 *     here with a real browser to open job boards.
 *
 * Every tracker tool is passed straight through. Four are added locally:
 * search_job_boards, read_job_posting, check_job_pages and
 * check_job_hunt_setup.
 *
 * The tracker decides which pages to open and reads what comes back; this file
 * only moves pages between Crawl4AI and the tracker. So it has no dependencies,
 * needs no build, and the knowledge of each job board lives in one tested place
 * (src/lib/job-search/).
 *
 * Configuration, all optional except the key:
 *   ~/.config/job-tracker/key            your personal key (jt_…), chmod 600
 *   ~/.config/job-tracker/url            the tracker, if not the default
 *   JOB_TRACKER_KEY / JOB_TRACKER_URL    the same, as environment variables
 *   ~/.config/job-tracker/crawl4ai-token the API token Crawl4AI was started with
 *   CRAWL4AI_URL / CRAWL4AI_API_TOKEN    the same, as environment variables
 *                                        (URL default http://127.0.0.1:11235)
 *
 * Nothing but protocol messages is ever written to stdout — anything else
 * there would corrupt the stream. Diagnostics go to stderr.
 */
import { readFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const VERSION = '1.0.0';
const DEFAULT_TRACKER = 'https://tracker-one-xi-95.vercel.app';
const CONFIG_DIR = process.env.JOB_TRACKER_CONFIG_DIR || join(homedir(), '.config', 'job-tracker');
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/** Kept in step with BOARD_IDS in src/lib/job-search.ts — the self-tests check. */
export const BOARD_IDS = ['linkedin', 'naukri', 'foundit', 'glassdoor', 'wellfound'];

const log = (...a) => process.stderr.write(`[job-hunt] ${a.join(' ')}\n`);

// ---------------------------------------------------------------------------
// Configuration — read on every call, so a new key needs no restart
// ---------------------------------------------------------------------------
function readConfig(name) {
  try {
    return readFileSync(join(CONFIG_DIR, name), 'utf8').trim();
  } catch {
    return '';
  }
}
const trackerUrl = () => (process.env.JOB_TRACKER_URL || readConfig('url') || DEFAULT_TRACKER).trim().replace(/\/+$/, '');
const trackerKey = () => (process.env.JOB_TRACKER_KEY || readConfig('key')).trim();
const crawlerUrl = () => (process.env.CRAWL4AI_URL || readConfig('crawl4ai-url') || 'http://127.0.0.1:11235').trim().replace(/\/+$/, '');
const crawlerToken = () => (process.env.CRAWL4AI_API_TOKEN || readConfig('crawl4ai-token')).trim();

/** A message written for the person, returned to the model as-is. */
class UserError extends Error {}

const NO_KEY = `No tracker key is saved on this computer yet. In the tracker open Jobs → Connect AI, create a key, click Copy, then run:\n  mkdir -p ~/.config/job-tracker && pbpaste > ~/.config/job-tracker/key && chmod 600 ~/.config/job-tracker/key`;

// ---------------------------------------------------------------------------
// The tracker
// ---------------------------------------------------------------------------
let seq = 0;

async function trackerRpc(method, params, timeoutMs = 90_000) {
  const key = trackerKey();
  if (!key) throw new UserError(NO_KEY);
  let res;
  try {
    res = await fetch(`${trackerUrl()}/api/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${key}`,
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new UserError(`Could not reach the tracker at ${trackerUrl()} (${e?.name === 'TimeoutError' ? 'timed out' : 'network error'}).`);
  }
  const body = await res.json().catch(() => null);
  if (res.status === 401) throw new UserError('The tracker did not accept the saved key — it may have been revoked. Create a new one under Jobs → Connect AI.');
  if (!res.ok && !body) throw new UserError(`The tracker answered HTTP ${res.status}.`);
  if (body?.error) throw new UserError(body.error.message || 'The tracker returned an error.');
  return body?.result;
}

async function trackerConnector(payload, timeoutMs = 45_000) {
  const key = trackerKey();
  if (!key) throw new UserError(NO_KEY);
  let res;
  try {
    res = await fetch(`${trackerUrl()}/api/connector`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new UserError(`Could not reach the tracker at ${trackerUrl()} (${e?.name === 'TimeoutError' ? 'timed out' : 'network error'}).`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new UserError(body?.error || `The tracker answered HTTP ${res.status}.`);
  return body;
}

// ---------------------------------------------------------------------------
// Crawl4AI
// ---------------------------------------------------------------------------
const NO_CRAWLER = () =>
  `Crawl4AI is not answering at ${crawlerUrl()}. Start Docker Desktop, then run:\n  docker start crawl4ai\nFirst time on this computer: npm run crawler:setup, in the tracker's folder.`;

export async function crawlerHealth() {
  try {
    const res = await fetch(`${crawlerUrl()}/health`, { signal: AbortSignal.timeout(4_000) });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = await res.json().catch(() => ({}));
    return { ok: true, version: body?.version ?? null };
  } catch {
    return { ok: false, detail: 'not reachable' };
  }
}

/** The address a crawl finished on: Crawl4AI's redirected_url, else the one asked for. */
export function landingOf(result, asked) {
  const u = typeof result?.redirected_url === 'string' && result.redirected_url ? result.redirected_url : typeof result?.url === 'string' && result.url ? result.url : asked;
  return u === asked || u.replace(/\/+$/, '') === asked.replace(/\/+$/, '') ? asked : u;
}

/** Markdown out of whatever shape this Crawl4AI version returns it in. */
function markdownOf(result) {
  const md = result?.markdown;
  if (typeof md === 'string') return md;
  return md?.raw_markdown || md?.markdown_with_citations || result?.markdown_v2?.raw_markdown || '';
}


// ---------------------------------------------------------------------------
// What the crawler may open
//
// Crawl4AI runs in Docker on this computer, where it can reach the router, the
// LAN and host.docker.internal — and whatever it reads goes back to a model.
// A job posting is text from the open web, and "open this link" is exactly
// what a hostile one would ask for. So board searches may only open the five
// boards, and a posting read may only open a public address.
// ---------------------------------------------------------------------------
const BOARD_HOSTS = [/(^|\.)linkedin\.com$/, /(^|\.)naukri\.com$/, /(^|\.)foundit\.in$/, /(^|\.)glassdoor\.(co\.in|com)$/, /(^|\.)wellfound\.com$/];

function privateAddress(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    // 198.18/15 is where a VPN such as Cloudflare WARP answers for private
    // names, so a company's internal hosts land there.
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:') && privateAddress(v.slice(7));
}

/** Null when the URL is safe to open, otherwise the reason it is not. */
export async function refuseUrl(raw, { boardsOnly = false } = {}) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return 'That is not a link.';
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Only web links can be opened.';
  if (u.username || u.password) return 'Links with credentials in them are not opened.';
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (boardsOnly) return BOARD_HOSTS.some((re) => re.test(host)) ? null : `Not a job board this connector searches: ${host}`;
  if (isIP(host)) return privateAddress(host) ? 'Addresses on this computer or its network are not opened.' : 'Links to bare IP addresses are not opened.';
  if (host === 'localhost' || /\.(local|internal|localhost|lan|home|corp)$/.test(host) || !host.includes('.')) {
    return 'Addresses on this computer or its network are not opened.';
  }
  try {
    const addrs = await lookup(host, { all: true });
    if (addrs.some((a) => privateAddress(a.address))) return 'That name points inside this network, so it is not opened.';
  } catch {
    return `Could not find ${host}.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// What the browser itself may reach
//
// Checking a link before opening it, and where the page landed after, covers
// what this connector can see. What it cannot see — a page that navigates
// with JavaScript once loaded, an image from the router, a name that answers
// differently between a check and a connection — is covered by Crawl4AI
// itself: from 0.9.4 its server sends the browser through its own pinning
// proxy, which resolves each connection once, refuses any address that is not
// global, and dials exactly the address it checked (egress_broker.py in the
// image). It also refuses a request that tries to set a proxy or browser
// flags, so no caller can switch that off. check_job_hunt_setup warns when
// the version is older, or when CRAWL4AI_ALLOW_INTERNAL_URLS turns it off.
// ---------------------------------------------------------------------------
export const EGRESS_GUARD_SINCE = '0.9.4';

/** True for a version at least `min`, compared number by number. */
export function versionAtLeast(version, min) {
  const a = String(version ?? '').split('.').map((n) => parseInt(n, 10));
  const b = min.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < b.length; i++) {
    const x = Number.isFinite(a[i]) ? a[i] : 0;
    if (x !== b[i]) return x > b[i];
  }
  return true;
}

/**
 * Opens one page in Crawl4AI's browser and returns it as markdown, plus the
 * job cards when the plan carries an extraction schema. Never throws: a page
 * that fails is reported, so one slow board cannot sink the others.
 */
export async function crawl(plan, timeoutMs = 50_000, { boardsOnly = true } = {}) {
  const refused = await refuseUrl(plan.url, { boardsOnly });
  if (refused) return { ...plan, markdown: '', items: null, status: null, error: refused };
  const params = {
    cache_mode: 'bypass',
    page_timeout: Math.max(15_000, timeoutMs - 10_000),
    wait_until: 'domcontentloaded',
    delay_before_return_html: plan.delay ?? 1,
    scan_full_page: Boolean(plan.scroll),
    remove_overlay_elements: true,
  };
  if (plan.waitFor) {
    params.wait_for = plan.waitFor;
    params.wait_for_timeout = 15_000;
  }
  if (plan.extract) {
    // Crawl4AI's config serialiser wants plain objects wrapped as typed dicts.
    params.extraction_strategy = { type: 'JsonCssExtractionStrategy', params: { schema: { type: 'dict', value: plan.extract } } };
  }
  const token = crawlerToken();
  try {
    const res = await fetch(`${crawlerUrl()}/crawl`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        urls: [plan.url],
        browser_config: { type: 'BrowserConfig', params: { headless: true, viewport_width: 1366, viewport_height: 900 } },
        crawler_config: { type: 'CrawlerRunConfig', params },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401) return { ...plan, markdown: '', items: null, status: null, error: 'Crawl4AI refused the saved token (~/.config/job-tracker/crawl4ai-token).' };
    if (!res.ok) return { ...plan, markdown: '', items: null, status: null, error: `Crawl4AI answered HTTP ${res.status}` };
    const body = await res.json();
    const r = Array.isArray(body?.results) ? body.results[0] : body;
    if (!r) return { ...plan, markdown: '', items: null, status: null, error: 'Crawl4AI returned nothing' };
    // Where the browser ended up, not where it was sent: a public page can
    // redirect to the router or to Crawl4AI itself, and whatever loads there
    // would go back to a model. The address is checked again, and the page
    // thrown away if it landed somewhere this connector would not have opened.
    const finalUrl = landingOf(r, plan.url);
    if (finalUrl !== plan.url) {
      const moved = await refuseUrl(finalUrl, { boardsOnly });
      if (moved) return { ...plan, markdown: '', items: null, status: null, finalUrl, error: `the page redirected somewhere this connector does not open (${moved})` };
    }
    const markdown = markdownOf(r);
    let items = null;
    if (plan.extract && r.extracted_content) {
      try {
        const parsed = typeof r.extracted_content === 'string' ? JSON.parse(r.extracted_content) : r.extracted_content;
        items = Array.isArray(parsed) ? parsed.slice(0, 200) : null;
      } catch {
        items = null;
      }
    }
    return {
      ...plan,
      // With cards in hand the markdown is only needed to spot a sign-in wall
      // or a bot check, so only the top of it travels.
      markdown: markdown.slice(0, items?.length ? 20_000 : 250_000),
      items,
      status: typeof r.status_code === 'number' ? r.status_code : null,
      finalUrl,
      error: r.success === false && !markdown ? String(r.error_message || 'the page did not load').slice(0, 200) : null,
    };
  } catch (e) {
    if (e?.name === 'TimeoutError') return { ...plan, markdown: '', items: null, status: null, error: 'the page took too long to load' };
    return { ...plan, markdown: '', items: null, status: null, error: 'Crawl4AI is not reachable' };
  }
}

export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Local tools
// ---------------------------------------------------------------------------
const text = (data) => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const fail = (message) => ({ content: [{ type: 'text', text: message }], isError: true });

const LOCAL_TOOLS = [
  {
    name: 'search_job_boards',
    title: 'Search job boards',
    description:
      'Searches LinkedIn, Naukri, foundit (Monster India), Glassdoor and Wellfound for one role, by opening each board\'s own search page with Crawl4AI on this computer. Returns listings with role, company, location, experience, salary and posting date where the board shows them, plus already_tracked when the tracker has the job. Takes 20–60 seconds. Boards that block or ask to sign in are reported, never guessed at.',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', maxLength: 120, description: 'One role title, e.g. "Software Engineer" or "SDE 1"' },
        location: { type: 'string', maxLength: 120, description: 'City, "India" or "Remote", e.g. "Bengaluru". Default India.' },
        boards: { type: 'array', items: { type: 'string', enum: BOARD_IDS }, description: 'Boards to search. Default: all.' },
        posted_within_days: { type: 'integer', minimum: 1, maximum: 30, description: 'Only recent postings. Default 14.' },
        experience_years: { type: 'integer', minimum: 0, maximum: 30, description: 'The low end of the experience asked for, e.g. 0 or 1 for SDE-1.' },
        seniority: { type: 'string', enum: ['entry', 'mid', 'senior', 'any'], description: 'Drop listings clearly above or below this level. Default any.' },
      },
      required: ['role'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run(args) {
      const role = String(args.role ?? '').trim();
      if (!role) return fail('Give a role to search for.');
      if (!(await crawlerHealth()).ok) return fail(NO_CRAWLER());
      const common = { posted_within_days: args.posted_within_days ?? 14, boards: args.boards };
      const { pages } = await trackerConnector({
        action: 'plan',
        role,
        location: args.location ?? 'India',
        experience_years: args.experience_years ?? null,
        ...common,
      });
      // LinkedIn goes on its own, one page at a time: it is the board most
      // likely to push back on a burst, and this is a personal, light search.
      const linkedin = pages.filter((p) => p.board === 'linkedin');
      const rest = pages.filter((p) => p.board !== 'linkedin');
      const [a, b] = await Promise.all([pool(rest, 3, (p) => crawl(p)), pool(linkedin, 1, (p) => crawl(p))]);
      const crawled = [...a, ...b].map(({ board, url, markdown, items, status, error }) => ({ board, url, markdown, items, status, error }));
      const parsed = await trackerConnector({
        action: 'parse',
        seniority: args.seniority ?? 'any',
        location: args.location ?? 'India',
        ...common,
        pages: crawled,
      });
      return text({
        today: parsed.today,
        query: { role, location: args.location ?? 'India', posted_within_days: common.posted_within_days, seniority: args.seniority ?? 'any' },
        listings: parsed.listings.map((l) => ({
          role: l.role,
          company: l.company || null,
          location: l.location || null,
          source: l.source,
          url: l.url,
          experience: l.experience || null,
          salary: l.salary || null,
          posted_on: l.postedOn,
          seniority: l.seniority,
          already_tracked: l.alreadyTracked,
          ...(l.existingId ? { existing_id: l.existingId } : {}),
          snippet: l.snippet || null,
        })),
        boards: parsed.boards,
      });
    },
  },
  {
    name: 'read_job_posting',
    title: 'Read a job posting',
    description:
      'Opens one job posting with Crawl4AI on this computer and returns its text, with experience, salary, work mode and posting date where the page states them, and posting_state: Open, Closed, Unclear or Blocked. Use it on the most promising listings before evaluating them and writing how-to-apply steps.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', format: 'uri', description: 'The posting to read' } },
      required: ['url'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run(args) {
      const url = String(args.url ?? '').trim();
      if (!/^https?:\/\//i.test(url)) return fail('Give an http(s) link to the posting.');
      if (!(await crawlerHealth()).ok) return fail(NO_CRAWLER());
      const page = await crawl({ url, delay: 1.5, scroll: false }, 45_000, { boardsOnly: false });
      if (page.error) return text({ url, readable: false, reason: page.error });
      const read = await trackerConnector({ action: 'posting', url, markdown: page.markdown, status: page.status, final_url: page.finalUrl });
      if (read.blocked) return text({ url, readable: false, reason: read.blocked, posting_state: read.posting_state ?? null });
      return text({
        url,
        readable: true,
        posting_state: read.posting_state ?? null,
        posting_reason: read.posting_reason ?? null,
        title: read.title || null,
        experience: read.experience || null,
        salary: read.salary || null,
        work_mode: read.workMode || null,
        posted_on: read.postedOn,
        text: read.text,
      });
    },
  },
  {
    name: 'check_job_pages',
    title: 'Check posting pages are still up',
    description:
      'For tracked jobs on sites with no posting API (LinkedIn, Naukri, company pages): opens each posting with Crawl4AI on this computer and records on the job whether it is still open. Call check_postings first and pass the ids it returned under needs_page_check — up to 8 at a time. Pages behind a sign-in or a bot check are recorded as Blocked, never as Closed. Never changes a status.',
    inputSchema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8, description: 'Job ids from check_postings → needs_page_check' } },
      required: ['ids'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async run(args) {
      const ids = (Array.isArray(args.ids) ? args.ids : []).map((i) => String(i).trim()).filter(Boolean).slice(0, 8);
      if (!ids.length) return fail('Give the job ids to check — check_postings lists them under needs_page_check.');
      if (!(await crawlerHealth()).ok) return fail(NO_CRAWLER());
      // The links come from the tracker, for jobs that are the user's own.
      const listed = await trackerRpc('tools/call', { name: 'check_postings', arguments: { ids } }, 60_000);
      if (listed?.isError) return fail(listed?.content?.[0]?.text || 'The tracker could not list those jobs.');
      let answer = {};
      try {
        answer = JSON.parse(listed?.content?.[0]?.text ?? '{}');
      } catch {
        return fail('The tracker answered in a shape this connector does not know. Update the connector (git pull in the tracker folder).');
      }
      const todo = Array.isArray(answer.needs_page_check) ? answer.needs_page_check.slice(0, 8) : [];
      const pages = await pool(todo, 3, async (j) => {
        const page = await crawl({ url: j.url, delay: 1.5, scroll: false }, 45_000, { boardsOnly: false });
        // The tracker reads 50,000 characters of a page; more would only risk the request's size limit.
        return { id: j.id, status: page.status, final_url: page.finalUrl ?? null, markdown: (page.markdown ?? '').slice(0, 50_000), error: page.error ?? null };
      });
      const recorded = pages.length ? await trackerConnector({ action: 'liveness', pages }, 60_000) : { results: [] };
      return text({
        today: answer.today,
        checked_by_api: { closed: answer.closed ?? [], open: answer.open ?? 0, unclear: answer.unclear ?? [] },
        checked_by_page: recorded.results ?? [],
        ...(recorded.not_saved ? { not_saved: recorded.not_saved } : {}),
      });
    },
  },
  {
    name: 'check_job_hunt_setup',
    title: 'Check the job hunt setup',
    description: 'Checks that Crawl4AI is running on this computer and that the tracker accepts the saved key, and says how to fix whatever is not working.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run() {
      const crawler = await crawlerHealth();
      let tracker;
      try {
        await trackerRpc('ping', {}, 15_000);
        const r = await trackerRpc('tools/call', { name: 'list_jobs', arguments: { limit: 1 } }, 30_000);
        const body = r?.content?.[0]?.text ?? '';
        tracker = r?.isError ? { ok: false, detail: body } : { ok: true, detail: 'key accepted, job tracking ready' };
      } catch (e) {
        tracker = { ok: false, detail: e.message };
      }
      const guarded = crawler.ok && versionAtLeast(crawler.version, EGRESS_GUARD_SINCE);
      return text({
        crawl4ai: crawler.ok
          ? {
              ok: true,
              url: crawlerUrl(),
              version: crawler.version,
              browser_egress: guarded
                ? `Crawl4AI ${crawler.version} keeps its browser to public addresses. Leave CRAWL4AI_ALLOW_INTERNAL_URLS unset.`
                : `Crawl4AI ${crawler.version ?? '(unknown version)'} predates the egress guard (${EGRESS_GUARD_SINCE}): a page could make its browser reach this computer's network. Update: npm run crawler:setup`,
            }
          : { ok: false, url: crawlerUrl(), fix: NO_CRAWLER() },
        tracker: { url: trackerUrl(), key_saved: Boolean(trackerKey()), ...tracker },
      });
    },
  },
];

const INSTRUCTIONS =
  "This connects the user's job application tracker (their own Notion, through their tracker website) with Crawl4AI on their computer. Use search_job_boards for LinkedIn, Naukri, foundit, Glassdoor and Wellfound; search_company_jobs for company career sites and job feeds; read_job_posting to read a posting in full; check_postings and then check_job_pages to find postings that have closed. Read get_job_hunt_playbook before a job search or an evaluation, and follow it. If something fails, call check_job_hunt_setup. Never apply, send messages or sign in on the user's behalf.";

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------
let remoteTools = null;
let remoteToolsAt = 0;

async function listRemoteTools() {
  if (remoteTools && Date.now() - remoteToolsAt < 5 * 60_000) return remoteTools;
  const r = await trackerRpc('tools/list', {}, 20_000);
  remoteTools = Array.isArray(r?.tools) ? r.tools : [];
  remoteToolsAt = Date.now();
  return remoteTools;
}

/** What the model sees when the tracker cannot be reached: one tool that explains. */
const OFFLINE_TOOL = (reason) => ({
  name: 'tracker_not_connected',
  title: 'Tracker not connected',
  description: `The job tracker's tools are unavailable: ${reason} Call this for the fix.`,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
});

/** A tool as clients see it: everything but the code that runs it. */
function publicTool(t) {
  return Object.fromEntries(Object.entries(t).filter(([k]) => k !== 'run'));
}

async function handle(msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
  if (!('method' in msg) || !('id' in msg)) return null; // notifications and stray responses
  const { id, method } = msg;
  const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  switch (method) {
    case 'initialize': {
      const v = PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0];
      return ok({
        protocolVersion: v,
        capabilities: { tools: {}, prompts: {} },
        serverInfo: { name: 'job-hunt', title: 'Job Hunt (tracker + Crawl4AI)', version: VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list': {
      let tracker;
      try {
        tracker = await listRemoteTools();
      } catch (e) {
        tracker = [OFFLINE_TOOL(e.message)];
      }
      return ok({ tools: [...tracker, ...LOCAL_TOOLS.map(publicTool)] });
    }
    case 'tools/call': {
      const name = String(params.name ?? '');
      const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      const local = LOCAL_TOOLS.find((t) => t.name === name);
      try {
        if (local) return ok(await local.run(args));
        if (name === 'tracker_not_connected') {
          try {
            await listRemoteTools();
            return ok(text('The tracker is reachable again. Ask for the tool list to refresh.'));
          } catch (e) {
            return ok(fail(e.message));
          }
        }
        return ok(await trackerRpc('tools/call', { name, arguments: args }));
      } catch (e) {
        if (e instanceof UserError) return ok(fail(e.message));
        log(`${name} failed:`, e?.stack || e);
        return ok(fail('That did not work. Try again in a moment, or call check_job_hunt_setup.'));
      }
    }
    case 'prompts/list':
    case 'prompts/get':
      try {
        return ok(await trackerRpc(method, params, 20_000));
      } catch (e) {
        return method === 'prompts/list' ? ok({ prompts: [] }) : err(-32602, e.message);
      }
    case 'resources/list':
      return ok({ resources: [] });
    case 'resources/templates/list':
      return ok({ resourceTemplates: [] });
    case 'logging/setLevel':
      return ok({});
    default:
      return err(-32601, `Method not found: ${method}`);
  }
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

// Only when run as a program — the self-tests import this file for BOARD_IDS.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('job-hunt.mjs')) {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  // Requests still being answered. When the client closes our input, these
  // are finished and sent before exiting — dropping them would lose replies
  // to calls the client already made.
  const inFlight = new Set();
  rl.on('line', (line) => {
    const s = line.trim();
    if (!s) return;
    let msg;
    try {
      msg = JSON.parse(s);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const work = (async () => {
      if (Array.isArray(msg)) {
        const out = (await Promise.all(msg.map(handle))).filter(Boolean);
        if (out.length) send(out);
        return;
      }
      const r = await handle(msg);
      if (r) send(r);
    })().catch((e) => log('request failed:', e?.stack || e));
    inFlight.add(work);
    work.finally(() => inFlight.delete(work));
  });
  rl.on('close', async () => {
    await Promise.allSettled([...inFlight]);
    process.exit(0);
  });
  log(`started (tracker ${trackerUrl()}, crawler ${crawlerUrl()}, key ${trackerKey() ? 'saved' : 'missing'})`);
}
