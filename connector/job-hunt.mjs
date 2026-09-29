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
 * Every tracker tool is passed straight through. Three are added locally:
 * search_job_boards, read_job_posting and check_job_hunt_setup.
 *
 * The tracker decides which pages to open and reads what comes back; this file
 * only moves pages between Crawl4AI and the tracker. So it has no dependencies,
 * needs no build, and the knowledge of each job board lives in one tested place
 * (src/lib/job-search.ts).
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

/** Markdown out of whatever shape this Crawl4AI version returns it in. */
function markdownOf(result) {
  const md = result?.markdown;
  if (typeof md === 'string') return md;
  return md?.raw_markdown || md?.markdown_with_citations || result?.markdown_v2?.raw_markdown || '';
}

/**
 * Opens one page in Crawl4AI's browser and returns it as markdown, plus the
 * job cards when the plan carries an extraction schema. Never throws: a page
 * that fails is reported, so one slow board cannot sink the others.
 */
export async function crawl(plan, timeoutMs = 50_000) {
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
      'Opens one job posting with Crawl4AI on this computer and returns its text, with experience, salary, work mode and posting date where the page states them. Use it on the most promising listings before scoring them and writing how-to-apply steps.',
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
      const page = await crawl({ url, delay: 1.5, scroll: false }, 45_000);
      if (page.error) return text({ url, readable: false, reason: page.error });
      const read = await trackerConnector({ action: 'posting', url, markdown: page.markdown, status: page.status });
      if (read.blocked) return text({ url, readable: false, reason: read.blocked });
      return text({
        url,
        readable: true,
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
      return text({
        crawl4ai: crawler.ok ? { ok: true, url: crawlerUrl(), version: crawler.version } : { ok: false, url: crawlerUrl(), fix: NO_CRAWLER() },
        tracker: { url: trackerUrl(), key_saved: Boolean(trackerKey()), ...tracker },
      });
    },
  },
];

const INSTRUCTIONS =
  "This connects the user's job application tracker (their own Notion, through their tracker website) with Crawl4AI on their computer. Use search_job_boards for LinkedIn, Naukri, foundit, Glassdoor and Wellfound; search_company_jobs for company career sites (Workday, Greenhouse, Lever, Ashby); read_job_posting to read a posting in full. Read get_job_hunt_playbook before a job search, and follow it. If something fails, call check_job_hunt_setup. Never apply, send messages or sign in on the user's behalf.";

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
