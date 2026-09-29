/**
 * Reading crawled board pages into listings, and single postings into text.
 *
 * Boards with an extraction schema come back as cards, read field by field.
 * Everything else — and every board whose selectors have gone stale — is read
 * from Crawl4AI's markdown, using the one thing all boards have in common: each
 * posting on a results page is a link to that posting, with its company, place,
 * experience, salary and age after it.
 */
import { shiftKey, todayKey, type DayKey } from '../date';
import { findDuplicate, type Job } from '../jobs';
import type { JobSource } from '../schema';
import { BOARDS, boardOf, type BoardId } from './boards';
import {
  INDIAN_PLACES,
  PLACES,
  companyFromSlug,
  experienceFromText,
  foldPlace,
  keepForLevel,
  looksLikePlace,
  postedFromText,
  primaryPlace,
  salaryFromText,
  seniorityOf,
  slug,
  type LevelWanted,
  type Listing,
} from './text';

// ---------------------------------------------------------------------------
// Parsing a crawled page
// ---------------------------------------------------------------------------

/**
 * `[text](url "title")` — the only markdown construct the parser needs.
 * Every repetition is bounded: these patterns run on pages from the open web,
 * and an unbounded `[^)]*` backtracks quadratically on a page full of `](`.
 */
const LINK = /\[([^\]\n]{0,300})\]\((https?:\/\/[^)\s]{1,2048})(?:\s+"[^"\n]{0,300}")?\)/g;
const IMAGE = /!\[[^\]\n]{0,500}\]\([^)\s]{0,2048}\)/g;

/** The most of one page the parser will read, and the most posting links it will follow. */
export const MAX_PAGE_CHARS = 250_000;
const MAX_LINKS = 500;

/** Markdown noise inside a card: images, emphasis, headings, bullets, table pipes. */
function plain(md: string): string {
  return md
    .replace(IMAGE, ' ')
    .replace(LINK, '$1')
    .replace(/[*_`#>|]+/g, ' ')
    .replace(/\\(.)/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function canonical(raw: string, base: string): URL | null {
  try {
    const u = new URL(raw, base);
    u.hash = '';
    return u;
  } catch {
    return null;
  }
}

/** Card lines worth reading: short, not boilerplate. */
const NOISE = /^(apply|save|saved|share|report|easy apply|be an early applicant|actively recruiting|promoted|new|featured|hot job|sign in|join now|view job|show more|reviews?|\d(\.\d)? ?★?|\d+ reviews?|more jobs|similar jobs)$/i;

export type ParsedPage = { board: BoardId; listings: Listing[]; blocked: string | null };

/**
 * Signs that the page is not results at all — a sign-in wall, a bot check, an
 * empty search. A page like that must read as "blocked", never as "no jobs".
 */
export function blockedReason(board: BoardId, markdown: string, httpStatus: number | null): string | null {
  const md = markdown.slice(0, 6000).toLowerCase();
  if (httpStatus === 403 || httpStatus === 429) return `${boardOf(board)?.label ?? board} refused the request (HTTP ${httpStatus}).`;
  if (/verify you are human|are you a robot|humans only|captcha|access denied|unusual traffic|request blocked|attention required|just a moment|security protections may/.test(md)) {
    return `${boardOf(board)?.label ?? board} showed a bot check instead of results.`;
  }
  if (board === 'linkedin' && /authwall|sign in to view|join linkedin|to see more jobs, sign in/.test(md) && !/\/jobs\/view\//.test(markdown)) {
    return 'LinkedIn asked to sign in instead of showing results.';
  }
  if (markdown.trim().length < 200) return `${boardOf(board)?.label ?? board} returned an empty page.`;
  return null;
}

/**
 * Cuts a results page into one card per posting link and reads each card.
 *
 * A posting often links twice (title and "Apply"), so cards are keyed by the
 * posting's canonical URL, and the first link — the title, on every board
 * measured — names the role.
 */
export function parseBoardPage(
  boardId: BoardId,
  pageUrl: string,
  markdown: string,
  today: DayKey = todayKey(),
): Listing[] {
  const board = boardOf(boardId);
  if (!board) return [];

  type Hit = { index: number; end: number; text: string; url: URL; key: string };
  const hits: Hit[] = [];
  for (const m of markdown.slice(0, MAX_PAGE_CHARS).matchAll(LINK)) {
    const u = canonical(m[2], pageUrl);
    if (!u || !board.isPosting(u)) continue;
    hits.push({ index: m.index ?? 0, end: (m.index ?? 0) + m[0].length, text: m[1], url: u, key: `${u.origin}${u.pathname}`.toLowerCase() });
    if (hits.length >= MAX_LINKS) break;
  }

  // Where the next *different* posting starts, for every hit, in one pass from
  // the end — finding it by scanning forward from each hit was quadratic on a
  // page that repeats one link.
  const nextDifferent: (number | undefined)[] = new Array(hits.length);
  let after: number | undefined;
  let afterKey = '';
  let sameRunStart: number | undefined;
  for (let i = hits.length - 1; i >= 0; i--) {
    if (hits[i].key === afterKey) {
      nextDifferent[i] = sameRunStart;
    } else {
      sameRunStart = after;
      nextDifferent[i] = after;
      afterKey = hits[i].key;
    }
    after = hits[i].index;
  }

  const byUrl = new Map<string, { title: string; start: number; end: number; url: URL }>();
  const order: string[] = [];
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const key = h.key;
    const title = plain(h.text);
    const nextStart = nextDifferent[i];
    const card = byUrl.get(key);
    if (card) {
      if (!card.title && title) card.title = title;
      continue;
    }
    byUrl.set(key, { title, start: h.end, end: Math.min(nextStart ?? h.end + 1200, h.end + 1200), url: h.url });
    order.push(key);
  }

  const out: Listing[] = [];
  for (const key of order) {
    const c = byUrl.get(key)!;
    const role = cleanRole(c.title);
    if (!role || role.length < 3) continue;
    const body = markdown.slice(c.start, c.end);
    const lines = body
      .split('\n')
      .map(plain)
      .map((l) => l.replace(/^[-•·\s]+/, '').trim())
      .filter((l) => l && !NOISE.test(l) && l !== role);
    const text = lines.join(' · ');
    const experience = experienceFromText(text);
    const location = placeIn(lines) ?? '';
    const company = companyIn(boardId, lines, c.url, role, location);
    out.push({
      role,
      company,
      location,
      source: board.source,
      url: tidyUrl(c.url),
      snippet: text.slice(0, 280),
      experience,
      salary: salaryFromText(text),
      postedOn: postedFromText(text, today),
      seniority: seniorityOf(role, experience),
      alreadyTracked: false,
      existingId: null,
    });
  }
  return out;
}

/** Tracking parameters off, so the stored link is the posting and nothing else. */
function tidyUrl(u: URL): string {
  const c = new URL(u.toString());
  for (const k of [...c.searchParams.keys()]) {
    if (/^(utm_|refid|trackingid|trk|position|pagenum|src|sid|xp|px|ebp|lipi)/i.test(k)) c.searchParams.delete(k);
  }
  return c.toString();
}

function cleanRole(t: string): string {
  return t
    .replace(/\s+/g, ' ')
    .replace(/\s*(?:with verification|\(verified\)|new|promoted|easy apply)\s*$/i, '')
    .replace(/^\s*(?:job|position)\s*:\s*/i, '')
    .trim();
}

function placeIn(lines: string[]): string | null {
  for (const l of lines.slice(0, 8)) {
    if (l.length <= 80 && looksLikePlace(l) && !/\d+\s*(yrs?|years?)/i.test(l)) return l.replace(/\s*·.*$/, '');
  }
  return null;
}

/**
 * The company: the first short line after the title that is not a place, an
 * experience range, a salary, a date or a rating — the order every board
 * measured uses. The posting URL settles it when the card does not.
 */
function companyIn(board: BoardId, lines: string[], url: URL, role: string, location: string): string {
  for (const l of lines.slice(0, 6)) {
    if (l.length > 70 || l === location) continue;
    if (looksLikePlace(l) || experienceFromText(l) || salaryFromText(l) || postedFromText(l)) continue;
    if (/\b(ago|posted|applicants?|reviews?|ratings?|lpa|lacs?|salary|not disclosed|hiring|jobs? in)\b/i.test(l)) continue;
    if (/^\d/.test(l) || l.toLowerCase() === role.toLowerCase()) continue;
    return l;
  }
  if (board === 'linkedin') {
    const m = /\/jobs\/view\/(.+)-\d{6,}/.exec(url.pathname)?.[1] ?? '';
    const at = m.lastIndexOf('-at-');
    if (at >= 0) return companyFromSlug(m.slice(at + 4));
  }
  return '';
}

// ---------------------------------------------------------------------------
// Reading extracted cards
// ---------------------------------------------------------------------------

type Card = Record<string, unknown>;

const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
/** Crawl4AI returns a list field as [{t: '…'}] or as plain strings, depending on version. */
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : str((x as Card)?.t ?? Object.values((x as Card) ?? {})[0]))).map(str).filter(Boolean) : [];

/** "Not disclosed" and friends are not a salary. */
const realSalary = (v: string) => (/not disclosed|confidential|^-+$/i.test(v) ? '' : v);

/**
 * One board's extracted cards as listings.
 *
 * Each board's fields map to the same listing; what differs is where the
 * posting link comes from. LinkedIn's card carries its job id, Naukri and
 * Glassdoor carry the link itself, and foundit carries only an id, from which
 * its public posting address is built.
 */
export function readCards(boardId: BoardId, cards: readonly unknown[], today: DayKey = todayKey()): Listing[] {
  const board = boardOf(boardId);
  if (!board) return [];
  const out: Listing[] = [];
  const seen = new Set<string>();
  for (const raw of cards) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Card;
    const role = cleanRole(str(c.title));
    if (!role) continue;
    let url = '';
    if (boardId === 'linkedin') {
      const id = /jobPosting:(\d+)/.exec(str(c.urn))?.[1] ?? /-(\d{6,})(?:\?|$)/.exec(str(c.href))?.[1];
      url = id ? `https://www.linkedin.com/jobs/view/${id}/` : '';
    } else if (boardId === 'foundit') {
      const id = /^\d{5,}$/.exec(str(c.jobId))?.[0];
      url = id ? `https://www.foundit.in/job/${slug(`${role} ${str(c.company)}`)}-${id}` : '';
    } else {
      const u = canonical(str(c.href), `https://${boardId === 'glassdoor' ? 'www.glassdoor.co.in' : 'www.naukri.com'}/`);
      url = u ? tidyUrl(u) : '';
    }
    if (!url || seen.has(url)) continue;
    seen.add(url);

    const details = strings(c.details);
    const experience = str(c.experience) ? experienceFromText(str(c.experience)) || str(c.experience) : experienceFromText(details.join(' '));
    const salary = realSalary(str(c.salary) || details.find((d) => salaryFromText(d) || /lpa|lacs?|₹/i.test(d)) || '');
    const posted = /^\d{4}-\d{2}-\d{2}/.test(str(c.posted)) ? str(c.posted).slice(0, 10) : postedFromText(str(c.age), today);
    const skills = strings(c.skills).slice(0, 8);
    out.push({
      role,
      company: str(c.company).replace(/\s*\d(\.\d)?\s*★?$/, ''),
      location: str(c.location),
      source: board.source,
      url,
      snippet: [str(c.snippet), skills.length ? `Skills: ${skills.join(', ')}` : ''].filter(Boolean).join(' · ').slice(0, 280),
      experience,
      salary,
      postedOn: posted,
      seniority: seniorityOf(role, experience),
      alreadyTracked: false,
      existingId: null,
    });
  }
  return out;
}

/**
 * Wellfound, from markdown. Its results are grouped by company: a
 * `## [Company](…/company/…)` heading, then that company's postings, each a
 * link followed by pay, place and age lines.
 */
export function readWellfound(markdown: string, today: DayKey = todayKey()): Listing[] {
  const out: Listing[] = [];
  let company = '';
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const co = /^#{2,3}\s*\[([^\]]+)\]\(https?:\/\/(?:www\.)?wellfound\.com\/company\//.exec(line);
    if (co) {
      company = str(co[1]);
      continue;
    }
    const job = /^\[([^\]]+)\]\((https?:\/\/(?:www\.)?wellfound\.com\/jobs\/\d+[^)\s]*)\)\s*(.*)$/.exec(line);
    if (!job) continue;
    const rest: string[] = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 7); j++) {
      const l = lines[j].trim();
      if (!l || /^\[/.test(l) || /^#{2,3}\s/.test(l)) break;
      rest.push(l);
    }
    const pay = rest.find((l) => /[$₹€£]|\bLPA\b/i.test(l)) ?? '';
    const age = rest.find((l) => postedFromText(l, today)) ?? '';
    const exp = experienceFromText(rest.join(' · '));
    const isPlace = (l: string) => PLACES.test(l) || /\b(in office|onsite|on-site|hybrid|remote)\b/i.test(l);
    const place =
      rest.find((l) => l !== pay && l !== age && isPlace(l) && l.length <= 80) ??
      rest.find((l) => l !== pay && l !== age && !experienceFromText(l) && !/^(save|apply)/i.test(l) && l.length <= 80) ??
      '';
    const role = cleanRole(job[1]);
    const u = canonical(job[2], 'https://wellfound.com/');
    if (!role || !u) continue;
    out.push({
      role,
      company,
      location: place,
      source: 'Wellfound',
      url: tidyUrl(u),
      snippet: [job[3], pay].filter(Boolean).join(' · ').slice(0, 280),
      experience: exp,
      salary: pay.split('•')[0].trim(),
      postedOn: postedFromText(age, today),
      seniority: seniorityOf(role, exp),
      alreadyTracked: false,
      existingId: null,
    });
  }
  return out;
}

/**
 * Whether a listing's place answers the search's. Only ever drops a listing
 * that names somewhere else: an empty location is kept, because boards leave
 * it out as often as they get it wrong.
 */
export function placeFits(listingLocation: string, wanted: string): boolean {
  const loc = foldPlace(listingLocation.trim());
  if (!loc) return true;
  const p = primaryPlace(wanted);
  if (!p.india && !p.city) return true;
  if (INDIAN_PLACES.test(loc)) return true;
  if (p.remote && /\bremote\b|anywhere|worldwide|apac|asia/i.test(loc)) return true;
  return false;
}

export type CrawledPage = {
  board: BoardId;
  url: string;
  markdown: string;
  /** Cards from the plan's extraction schema, when it had one. */
  items?: unknown[] | null;
  status: number | null;
  error?: string | null;
};

export type BoardOutcome = {
  board: BoardId;
  source: JobSource;
  status: 'ok' | 'empty' | 'blocked' | 'failed';
  found: number;
  note?: string;
};

/**
 * Everything the connector crawled, read into listings: filtered to the level,
 * place and recency asked for, de-duplicated across boards, and marked when
 * already tracked. A board that showed a sign-in wall or a bot check is
 * reported as blocked — never as "no jobs", which would be a lie.
 */
export function parseCrawl(
  pages: readonly CrawledPage[],
  opts: { seniority: LevelWanted; postedWithinDays: number; location: string },
  existing: readonly Job[],
  today: DayKey = todayKey(),
): { listings: Listing[]; boards: BoardOutcome[] } {
  const oldest = opts.postedWithinDays > 0 ? shiftKey(today, -opts.postedWithinDays) : null;
  const seen = new Set<string>();
  const listings: Listing[] = [];
  const boards: BoardOutcome[] = [];
  for (const p of pages) {
    const board = boardOf(p.board);
    if (!board) continue;
    if (p.error) {
      boards.push({ board: p.board, source: board.source, status: 'failed', found: 0, note: p.error });
      continue;
    }
    let parsed =
      p.board === 'wellfound'
        ? readWellfound(p.markdown, today)
        : Array.isArray(p.items) && p.items.length
          ? readCards(p.board, p.items, today)
          : [];
    // Selectors go stale when a board redesigns. The markdown reading is
    // cruder, but it keeps a search working until the selectors are updated.
    if (!parsed.length) parsed = parseBoardPage(p.board, p.url, p.markdown, today);
    const blocked = blockedReason(p.board, p.markdown, p.status);
    if (!parsed.length && blocked) {
      boards.push({ board: p.board, source: board.source, status: 'blocked', found: 0, note: blocked });
      continue;
    }
    let kept = 0;
    for (const l of parsed) {
      const k = l.url.toLowerCase();
      if (seen.has(k) || !keepForLevel(l, opts.seniority) || !placeFits(l.location, opts.location)) continue;
      if (oldest && l.postedOn && l.postedOn < oldest) continue;
      seen.add(k);
      const dup = findDuplicate({ jobUrl: l.url, applyUrl: null, company: l.company, role: l.role, location: l.location }, existing);
      listings.push({ ...l, alreadyTracked: Boolean(dup), existingId: dup?.id ?? null });
      kept++;
    }
    boards.push({ board: p.board, source: board.source, status: kept ? 'ok' : 'empty', found: kept });
  }
  return { listings, boards };
}

// ---------------------------------------------------------------------------
// One posting
// ---------------------------------------------------------------------------

export type PostingRead = {
  url: string;
  title: string;
  experience: string;
  salary: string;
  postedOn: DayKey | null;
  workMode: string;
  /** The posting as text, trimmed to what a model can use. */
  text: string;
  blocked: string | null;
};

/** What can be read from a posting page without a model; the text carries the rest. */
export function readPostingPage(url: string, markdown: string, status: number | null, today: DayKey = todayKey()): PostingRead {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    /* reported below as blocked */
  }
  const text = markdown
    .slice(0, 50_000)
    .replace(IMAGE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 9000);
  const head = text.slice(0, 3000);
  const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? '';
  const mode = /\b(fully remote|remote|hybrid|on[- ]?site|work from office|in[- ]office)\b/i.exec(head)?.[1] ?? '';
  const boardId = BOARDS.find((b) => {
    try {
      return b.isPosting(new URL(url));
    } catch {
      return false;
    }
  })?.id;
  const blocked =
    !host ? 'That is not a link.' : boardId ? (text.length < 300 ? blockedReason(boardId, markdown, status) : null) : text.length < 200 ? 'The page came back empty.' : null;
  return {
    url,
    title,
    experience: experienceFromText(head),
    salary: salaryFromText(head),
    postedOn: postedFromText(head, today),
    workMode: mode,
    text,
    blocked,
  };
}
