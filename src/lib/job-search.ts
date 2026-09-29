/**
 * Job boards, crawled with Crawl4AI on the user's own computer.
 *
 * The tracker never crawls anything itself — it runs on Vercel, where there is
 * no browser, and Crawl4AI runs on the user's machine, which Vercel cannot
 * reach. So a board search is split in two:
 *
 *   plan   here   — which page to open on each board, for this role and place
 *   crawl  local  — the Job Hunt connector opens those pages with Crawl4AI
 *   parse  here   — the rendered pages come back and are read into listings
 *
 * Both ends that need knowledge of the boards (their URLs and the shape of
 * their pages) live here, in one tested file; the connector only moves pages.
 *
 * Parsing works on the markdown Crawl4AI produces, and uses the one thing every
 * board has in common: each posting on a results page is a link to that
 * posting, and its company, place, experience, salary and age follow it. So a
 * page is cut into cards at each posting link and each card is read with the
 * same small set of patterns.
 */
import { shiftKey, todayKey, type DayKey } from './date';
import { findDuplicate, type Job } from './jobs';
import type { JobSource } from './schema';

// ---------------------------------------------------------------------------
// Reading text
// ---------------------------------------------------------------------------

export type Seniority = 'intern' | 'entry' | 'mid' | 'senior' | 'unknown';
export type LevelWanted = 'entry' | 'mid' | 'senior' | 'any';

export type Listing = {
  role: string;
  company: string;
  location: string;
  source: JobSource;
  url: string;
  /** A little of what the page said about the posting, for the model to read. */
  snippet: string;
  experience: string;
  salary: string;
  /** Estimated from "3 days ago" style text; null when not stated. */
  postedOn: DayKey | null;
  seniority: Seniority;
  alreadyTracked: boolean;
  existingId: string | null;
};

const titleCase = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

/** A company name from a URL slug: `progress-software` → "Progress Software". */
export function companyFromSlug(slug: string): string {
  const s = slug.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? titleCase(s.toLowerCase()) : '';
}

/**
 * Posting age written as text — "3 days ago", "18 hours ago", "Posted 11 Days
 * Ago", "yesterday", "Just now" — turned into a day. Hours count as today.
 */
export function postedFromText(text: string, today: DayKey = todayKey()): DayKey | null {
  const s = text.toLowerCase();
  if (/\b(just now|today|few (minutes|hours) ago|just posted)\b/.test(s)) return today;
  if (/\byesterday\b/.test(s)) return shiftKey(today, -1);
  // Glassdoor's short form: "24h", "5d", "30d+".
  const short = /^\s*(\d{1,3})\s*([hdwm])\+?\s*$/.exec(s);
  if (short) {
    const n = Number(short[1]);
    const d = short[2] === 'h' ? 0 : short[2] === 'd' ? n : short[2] === 'w' ? n * 7 : n * 30;
    return d > 365 ? null : shiftKey(today, -d);
  }
  const m = /\b(\d{1,3})\+?\s*(minute|min|hour|hr|day|week|month)s?\s+ago\b/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  const days = unit.startsWith('min') || unit.startsWith('h') ? 0 : unit === 'day' ? n : unit === 'week' ? n * 7 : n * 30;
  return days > 365 ? null : shiftKey(today, -days);
}

/** "2 to 7 years", "0 - 2 Yrs", "4+ years", "Fresher" → a short range, or ''. */
export function experienceFromText(text: string): string {
  const range = /\b(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*(?:years?|yrs?)\b/i.exec(text);
  if (range) return `${range[1]}–${range[2]} yrs`;
  const plus = /\b(\d{1,2})\s*\+\s*(?:years?|yrs?)\b/i.exec(text);
  if (plus) return `${plus[1]}+ yrs`;
  // Wellfound: "2 years of exp".
  const of = /\b(\d{1,2})\s*(?:years?|yrs?)\s+(?:of\s+)?(?:exp|experience)\b/i.exec(text);
  if (of) return `${of[1]}+ yrs`;
  if (/\bfreshers?\b/i.test(text)) return '0 yrs';
  return '';
}

/** Rupee ranges ("₹7L - ₹9L", "₹19L - ₹23L / yr"), LPA figures, and "12-18 Lacs PA", as written. */
export function salaryFromText(text: string): string {
  const inr = /₹\s?[\d.,]+\s?(?:L|Lakh|Cr|K)?\s*[-–]\s*₹?\s?[\d.,]+\s?(?:L|Lakh|Cr|K)?(?:\s*\/\s*yr)?/i.exec(text);
  if (inr) return inr[0].replace(/\s+/g, ' ').trim();
  const lpa = /\b\d{1,2}(?:\.\d{1,2})?\s*[-–]\s*\d{1,2}(?:\.\d{1,2})?\s*(?:LPA|lacs?(?:\s*P\.?A\.?)?|lakhs?(?:\s*P\.?A\.?)?)/i.exec(text);
  return lpa ? lpa[0].replace(/\s+/g, ' ').trim() : '';
}

/**
 * A rough level from the title and the stated experience, so a search for
 * entry-level roles can drop the Staff and Principal postings a keyword search
 * always drags in. Unknown is kept, never guessed into a bucket.
 */
export function seniorityOf(role: string, experience: string): Seniority {
  const r = role.toLowerCase();
  if (/\b(intern|internship|trainee|apprentice)\b/.test(r)) return 'intern';
  if (/\b(senior|sr\.?|staff|principal|lead|manager|architect|director|dir|head|vp|avp|svp|evp|vice president|distinguished|fellow)\b/.test(r)) return 'senior';
  if (/\b(junior|jr\.?|graduate|entry|fresher|associate|new grad)\b/.test(r) || /\b(sde|swe|engineer|developer)\s*(-|\s)?\s*(i|1)\b/.test(r)) return 'entry';
  const min = /^(\d{1,2})/.exec(experience)?.[1];
  if (min !== undefined) {
    const n = Number(min);
    if (n <= 1) return 'entry';
    if (n <= 4) return 'mid';
    return 'senior';
  }
  if (/\b(ii|2|iii|3)\b/.test(r)) return 'mid';
  return 'unknown';
}

const LEVEL: Record<Seniority, number> = { intern: 0, entry: 1, mid: 2, senior: 3, unknown: -1 };

export function keepForLevel(l: Pick<Listing, 'seniority' | 'experience'>, wanted: LevelWanted): boolean {
  if (wanted === 'any' || l.seniority === 'unknown') return true;
  if (wanted === 'entry') {
    if (l.seniority === 'entry' || l.seniority === 'intern') return true;
    // "Software Engineer 2" with 0–2 or 2–4 years is still reachable from SDE-1.
    return l.seniority === 'mid' && !/^([3-9]|\d\d)/.test(l.experience);
  }
  if (wanted === 'mid') return LEVEL[l.seniority] >= 1 && LEVEL[l.seniority] <= 2;
  return LEVEL[l.seniority] >= 2;
}

/** Indian cities and regions a posting might name. */
export const INDIAN_PLACES =
  /\b(bengaluru|bangalore|pune|hyderabad|secunderabad|chennai|mumbai|navi mumbai|thane|delhi|new delhi|ncr|gurgaon|gurugram|noida|kolkata|ahmedabad|kochi|cochin|jaipur|coimbatore|chandigarh|indore|trivandrum|thiruvananthapuram|mysore|mysuru|vadodara|nagpur|bhubaneswar|india)\b/i;

/** Any place a title fragment might name, remote included. */
export const PLACES = new RegExp(INDIAN_PLACES.source.replace(/\|india\)/, '|india|remote|anywhere)'), 'i');

/** True for a fragment that names a place rather than a role or a company. */
export function looksLikePlace(s: string): boolean {
  return PLACES.test(s) && s.split(/\s+/).length <= 8 && !/\b(engineer|developer|sde|analyst|lead|manager)\b/i.test(s);
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

export type BoardId = 'linkedin' | 'naukri' | 'foundit' | 'glassdoor' | 'wellfound';

export type BoardQuery = {
  role: string;
  /** As the person wrote it: "Bengaluru", "Remote India", "Pune or Hyderabad". */
  location: string;
  postedWithinDays: number;
  /** The low end of the experience asked for, when known. */
  minYears: number | null;
};

/** One page for the connector to open, with how long to let it render. */
export type PagePlan = {
  board: BoardId;
  url: string;
  /** A CSS selector Crawl4AI should wait for, when the board renders late. */
  waitFor?: string;
  /** Extra settle time after load, in seconds. */
  delay: number;
  /** Scroll to the bottom first, for boards that load cards lazily. */
  scroll: boolean;
  /**
   * Crawl4AI CSS extraction schema: one record per job card, read in the
   * browser. Boards without one are read from the page's markdown.
   */
  extract?: ExtractSchema;
};

/** Crawl4AI's JsonCssExtractionStrategy schema, as the connector passes it through. */
export type ExtractField = {
  name: string;
  selector?: string;
  type: 'text' | 'attribute' | 'list';
  attribute?: string;
  fields?: ExtractField[];
};
export type ExtractSchema = { name: string; baseSelector: string; baseFields?: ExtractField[]; fields: ExtractField[] };

const cssText = (name: string, selector: string): ExtractField => ({ name, selector, type: 'text' });
const cssAttr = (name: string, selector: string, attribute: string): ExtractField => ({ name, selector, type: 'attribute', attribute });

type Board = {
  id: BoardId;
  source: JobSource;
  label: string;
  /** True for a URL that is one posting, not a list or a company page. */
  isPosting: (u: URL) => boolean;
  plan: (q: BoardQuery) => Omit<PagePlan, 'board'>;
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** The first real place in the query — "Bengaluru" out of "Bengaluru or Remote". */
export function primaryPlace(location: string): { city: string | null; remote: boolean; india: boolean } {
  const l = location.toLowerCase();
  const remote = /\bremote\b|\bwfh\b|work from home/.test(l);
  const m = INDIAN_PLACES.exec(l);
  const hit = m?.[1] ?? null;
  const city = hit && hit !== 'india' ? (hit === 'bangalore' ? 'bengaluru' : hit === 'gurgaon' ? 'gurugram' : hit) : null;
  return { city, remote, india: /\bindia\b/.test(l) || Boolean(city) || !l.trim() };
}

export const BOARDS: readonly Board[] = [
  {
    id: 'linkedin',
    source: 'LinkedIn',
    label: 'LinkedIn',
    isPosting: (u) => /(^|\.)linkedin\.com$/.test(u.hostname) && /\/jobs\/view\//.test(u.pathname),
    // The public, signed-out search page — the one anyone sees without an
    // account. One page per search, never paged through: this is a personal
    // search, and it should look like one.
    plan: (q) => {
      const p = primaryPlace(q.location);
      const where = p.city ? `${titleCase(p.city)}, India` : 'India';
      const params = new URLSearchParams({ keywords: q.role, location: where, position: '1', pageNum: '0' });
      if (q.postedWithinDays > 0) params.set('f_TPR', `r${Math.min(q.postedWithinDays, 30) * 86400}`);
      if (p.remote) params.set('f_WT', '2');
      if (q.minYears !== null && q.minYears <= 2) params.set('f_E', '1,2');
      return {
        url: `https://www.linkedin.com/jobs/search?${params}`,
        delay: 1.5,
        scroll: false,
        extract: {
          name: 'linkedin',
          baseSelector: 'div.base-search-card',
          baseFields: [{ name: 'urn', type: 'attribute', attribute: 'data-entity-urn' }],
          fields: [
            cssText('title', 'h3.base-search-card__title'),
            cssText('company', 'h4.base-search-card__subtitle'),
            cssText('location', '.job-search-card__location'),
            cssAttr('posted', 'time', 'datetime'),
            cssText('age', 'time'),
            cssText('salary', '.job-search-card__salary-info'),
            cssAttr('href', 'a.base-card__full-link', 'href'),
          ],
        },
      };
    },
  },
  {
    id: 'naukri',
    source: 'Naukri',
    label: 'Naukri',
    isPosting: (u) => /(^|\.)naukri\.com$/.test(u.hostname) && /\/job-listings-/.test(u.pathname),
    plan: (q) => {
      const p = primaryPlace(q.location);
      const base = p.city ? `https://www.naukri.com/${slug(q.role)}-jobs-in-${slug(p.city)}` : `https://www.naukri.com/${slug(q.role)}-jobs`;
      const params = new URLSearchParams({ k: q.role });
      if (p.city) params.set('l', p.city);
      if (q.minYears !== null) params.set('experience', String(q.minYears));
      if (q.postedWithinDays > 0) params.set('jobAge', String(Math.min(q.postedWithinDays, 30)));
      if (p.remote) params.set('wfhType', '2');
      return {
        url: `${base}?${params}`,
        // Naukri paints its results after load; without the wait the page is
        // all filters and no jobs.
        waitFor: 'css:.srp-jobtuple-wrapper',
        delay: 1,
        scroll: false,
        extract: {
          name: 'naukri',
          baseSelector: 'div.srp-jobtuple-wrapper',
          baseFields: [{ name: 'jobId', type: 'attribute', attribute: 'data-job-id' }],
          fields: [
            cssText('title', 'a.title'),
            cssAttr('href', 'a.title', 'href'),
            cssText('company', 'a.comp-name'),
            cssAttr('experience', '.exp-wrap span[title]', 'title'),
            cssAttr('location', '.loc-wrap span[title]', 'title'),
            cssAttr('salary', '.sal-wrap span[title]', 'title'),
            cssText('age', '.job-post-day'),
            cssText('snippet', '.job-desc'),
            { name: 'skills', selector: 'ul.tags-gt li', type: 'list', fields: [{ name: 't', type: 'text' }] },
          ],
        },
      };
    },
  },
  {
    id: 'foundit',
    source: 'foundit',
    label: 'foundit (Monster India)',
    isPosting: (u) => /(^|\.)foundit\.in$/.test(u.hostname) && /^\/job\/[^/]+-\d+/.test(u.pathname),
    plan: (q) => {
      const p = primaryPlace(q.location);
      const params = new URLSearchParams({ query: q.role });
      if (p.city) params.set('locations', titleCase(p.city));
      if (q.minYears !== null) params.set('experienceRanges', `${q.minYears}~${q.minYears + 2}`);
      if (q.postedWithinDays > 0) params.set('jobFreshness', String(Math.min(q.postedWithinDays, 30)));
      return {
        url: `https://www.foundit.in/srp/results?${params}`,
        delay: 3,
        scroll: true,
        extract: {
          name: 'foundit',
          baseSelector: 'div.cardContainer',
          baseFields: [{ name: 'jobId', type: 'attribute', attribute: 'id' }],
          fields: [
            cssText('title', '.jobTitle'),
            cssText('company', '.companyName'),
            { name: 'details', selector: '.experienceSalary .details', type: 'list', fields: [{ name: 't', type: 'text' }] },
            cssText('location', '.details.location'),
            cssText('age', '.timeText'),
          ],
        },
      };
    },
  },
  {
    id: 'glassdoor',
    source: 'Glassdoor',
    label: 'Glassdoor',
    isPosting: (u) => /glassdoor\./.test(u.hostname) && (/\/job-listing\//.test(u.pathname) || u.searchParams.has('jl')),
    plan: (q) => {
      const p = primaryPlace(q.location);
      const params = new URLSearchParams({ 'sc.keyword': q.role, locKeyword: p.city ? titleCase(p.city) : 'India' });
      if (q.postedWithinDays > 0) params.set('fromAge', String(Math.min(q.postedWithinDays, 30)));
      if (p.remote) params.set('remoteWorkType', '1');
      return {
        url: `https://www.glassdoor.co.in/Job/jobs.htm?${params}`,
        delay: 2,
        scroll: false,
        extract: {
          name: 'glassdoor',
          baseSelector: 'li[data-test="jobListing"]',
          baseFields: [{ name: 'jobId', type: 'attribute', attribute: 'data-jobid' }],
          fields: [
            cssText('title', 'a[data-test="job-title"]'),
            cssAttr('href', 'a[data-test="job-title"]', 'href'),
            cssText('company', '[class*="EmployerProfile_compactEmployerName"]'),
            cssText('location', '[data-test="emp-location"]'),
            cssText('salary', '[data-test="detailSalary"]'),
            cssText('age', '[data-test="job-age"]'),
          ],
        },
      };
    },
  },
  {
    id: 'wellfound',
    source: 'Wellfound',
    label: 'Wellfound',
    isPosting: (u) => /(^|\.)wellfound\.com$/.test(u.hostname) && /^\/jobs\/\d+/.test(u.pathname),
    // Read from markdown: Wellfound groups jobs under a company heading, and a
    // CSS card cannot see its parent's heading.
    plan: (q) => {
      const p = primaryPlace(q.location);
      // Wellfound spells its city pages its own way, and an unknown one
      // silently falls back to worldwide results — measured: "bengaluru" gave
      // 42 US jobs, "bangalore" gave 32 in India.
      const WF: Record<string, string> = { bengaluru: 'bangalore', gurugram: 'gurgaon', 'new delhi': 'new-delhi' };
      const city = p.city ? (WF[p.city] ?? slug(p.city)) : 'india';
      const path = p.remote && !p.city ? `r/${slug(q.role)}` : `l/${slug(q.role)}/${city}`;
      return { url: `https://wellfound.com/role/${path}`, delay: 2, scroll: true };
    },
  },
];

export const BOARD_IDS = BOARDS.map((b) => b.id);
const boardOf = (id: string) => BOARDS.find((b) => b.id === id);

export function planBoardSearch(q: BoardQuery, boards: readonly BoardId[] = BOARD_IDS): PagePlan[] {
  return BOARDS.filter((b) => boards.includes(b.id)).map((b) => ({ board: b.id, ...b.plan(q) }));
}

// ---------------------------------------------------------------------------
// Parsing a crawled page
// ---------------------------------------------------------------------------

/** `[text](url "title")` — the only markdown construct the parser needs. */
const LINK = /\[([^\]]{0,300})\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g;

/** Markdown noise inside a card: images, emphasis, headings, bullets, table pipes. */
function plain(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
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

  type Hit = { index: number; end: number; text: string; url: URL };
  const hits: Hit[] = [];
  for (const m of markdown.matchAll(LINK)) {
    const u = canonical(m[2], pageUrl);
    if (!u || !board.isPosting(u)) continue;
    hits.push({ index: m.index ?? 0, end: (m.index ?? 0) + m[0].length, text: m[1], url: u });
  }

  const byUrl = new Map<string, { title: string; start: number; end: number; url: URL }>();
  const order: string[] = [];
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const key = `${h.url.origin}${h.url.pathname}`.toLowerCase();
    const title = plain(h.text);
    const nextStart = hits.slice(i + 1).find((x) => `${x.url.origin}${x.url.pathname}`.toLowerCase() !== key)?.index;
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
  const loc = listingLocation.trim();
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
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
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
