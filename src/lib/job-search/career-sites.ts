/**
 * Company career sites, read through their own public job APIs.
 *
 * Workday, Greenhouse, Lever and Ashby each publish every open role on a
 * company's board as JSON — no browser, no crawler, no key — because that is
 * how job boards syndicate them. So this part of search runs right here on the
 * server, and is available to every AI tool, including the ones that can only
 * reach the tracker over the internet.
 *
 * What these APIs cannot do is search across companies: each answers for one
 * board. So the tracker ships a list of boards (data/career-sites.json, every
 * entry checked against its API before it was added) and adds the companies in
 * the user's own profile on top.
 */
import sites from '../../../data/career-sites.json';

// The four job APIs answer with untyped JSON; each reader narrows it at once.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { shiftKey, todayKey, type DayKey } from '../date';
import { findDuplicate, own, type Job } from '../jobs';
import { normalize } from '../search';
import { INDIAN_PLACES, foldPlace, keepForLevel, postedFromText, seniorityOf, type LevelWanted, type Listing } from './text';
import type { JobSource } from '../schema';

export type Ats = 'greenhouse' | 'lever' | 'ashby' | 'workday';

export type CareerSite =
  | { name: string; ats: 'greenhouse' | 'lever' | 'ashby'; slug: string }
  | { name: string; ats: 'workday'; host: string; tenant: string; site: string };

export const CAREER_SITES = (sites as { sites: CareerSite[] }).sites;

const SOURCE: Record<Ats, JobSource> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workday: 'Workday',
};

/** One posting from a company board, before any filtering. */
type Raw = { title: string; location: string; url: string; postedOn: DayKey | null; remote: boolean };

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 12_000;
/**
 * The whole search must answer inside one serverless function (60 s) with room
 * to spare, so boards not reached by this point are reported as skipped
 * rather than waited for.
 */
const DEADLINE_MS = 35_000;

async function getJson(url: string, body?: unknown): Promise<any> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      signal: abort.signal,
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const day = (v: unknown): DayKey | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString().slice(0, 10);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
};

/** Workday writes "Posted Today", "Posted Yesterday", "Posted 3 Days Ago", "Posted 30+ Days Ago". */
export function workdayPosted(text: string, today: DayKey = todayKey()): DayKey | null {
  const s = text.toLowerCase();
  if (/today/.test(s)) return today;
  if (/yesterday/.test(s)) return shiftKey(today, -1);
  return postedFromText(s.replace(/^posted\s+/, ''), today);
}

async function fetchBoard(site: CareerSite, query: string): Promise<Raw[]> {
  const today = todayKey();
  switch (site.ats) {
    case 'greenhouse': {
      const j = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(site.slug)}/jobs`);
      return (j?.jobs ?? []).map((x: any) => ({
        title: String(x?.title ?? ''),
        location: String(x?.location?.name ?? ''),
        url: String(x?.absolute_url ?? ''),
        postedOn: day(x?.first_published) ?? day(x?.updated_at),
        remote: /remote/i.test(String(x?.location?.name ?? '')),
      }));
    }
    case 'lever': {
      const j = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(site.slug)}?mode=json`);
      return (Array.isArray(j) ? j : []).map((x: any) => {
        const locs = [x?.categories?.location, ...(x?.categories?.allLocations ?? [])].filter(Boolean);
        return {
          title: String(x?.text ?? ''),
          location: [...new Set(locs)].join(' / '),
          url: String(x?.hostedUrl ?? ''),
          postedOn: day(x?.createdAt),
          remote: x?.workplaceType === 'remote' || /remote/i.test(locs.join(' ')),
        };
      });
    }
    case 'ashby': {
      const j = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(site.slug)}`);
      return (j?.jobs ?? []).map((x: any) => {
        const locs = [x?.location, ...(x?.secondaryLocations ?? []).map((s: any) => s?.location)].filter(Boolean);
        return {
          title: String(x?.title ?? ''),
          location: [...new Set(locs)].join(' / '),
          url: String(x?.jobUrl ?? ''),
          postedOn: day(x?.publishedAt),
          remote: x?.isRemote === true || /remote/i.test(String(x?.workplaceType ?? '')),
        };
      });
    }
    case 'workday': {
      // Workday searches server-side, so the role goes into the request and
      // the result depends on it — unlike the other three, which list all.
      const j = await getJson(`https://${site.host}/wday/cxs/${site.tenant}/${site.site}/jobs`, {
        appliedFacets: {},
        limit: 20,
        offset: 0,
        searchText: query,
      });
      return (j?.jobPostings ?? []).map((x: any) => ({
        title: String(x?.title ?? ''),
        location: String(x?.locationsText ?? ''),
        url: `https://${site.host}/${site.site}${String(x?.externalPath ?? '')}`,
        postedOn: workdayPosted(String(x?.postedOn ?? ''), today),
        remote: /remote/i.test(String(x?.locationsText ?? '')),
      }));
    }
  }
}

/**
 * Boards change slowly, and one job search is usually three or four roles in
 * a row, so each board's full list is kept for a few minutes. Workday is keyed
 * by query too, since its answer depends on it.
 */
const BOARD_TTL_MS = 10 * 60_000;
const boardCache = new Map<string, { at: number; rows: Raw[] }>();

function siteKey(s: CareerSite): string {
  return s.ats === 'workday' ? `workday:${s.host}/${s.site}` : `${s.ats}:${s.slug}`;
}

async function boardRows(site: CareerSite, query: string): Promise<Raw[]> {
  const key = site.ats === 'workday' ? `${siteKey(site)}?${normalize(query)}` : siteKey(site);
  const hit = boardCache.get(key);
  if (hit && Date.now() - hit.at < BOARD_TTL_MS) return hit.rows;
  const rows = await fetchBoard(site, query);
  boardCache.set(key, { at: Date.now(), rows });
  if (boardCache.size > 500) boardCache.delete(boardCache.keys().next().value!);
  return rows;
}

/** Runs `fn` over `items` with at most `n` in flight, starting none after `deadline`. */
async function pool<T, R>(items: readonly T[], n: number, deadline: number, fn: (t: T) => Promise<R>, late: (t: T) => R): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = Date.now() > deadline ? late(items[i]) : await fn(items[i]);
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Alternatives a title may use for a word in the query. Titles are not
 * written the way people search: "SDE" is "Software Development Engineer" on
 * one board and "Software Engineer" on the next.
 */
const SYNONYMS: Record<string, string[]> = {
  engineer: ['engineer', 'developer', 'engineering'],
  developer: ['developer', 'engineer', 'programmer'],
  sde: ['sde', 'software development engineer', 'software engineer', 'swe', 'member of technical staff', 'mts'],
  swe: ['swe', 'software engineer', 'sde', 'software development engineer'],
  software: ['software', 'sde', 'swe'],
  backend: ['backend', 'back end', 'server side', 'platform'],
  frontend: ['frontend', 'front end', 'ui engineer', 'web'],
  fullstack: ['fullstack', 'full stack'],
  ml: ['ml', 'machine learning'],
  ai: ['ai', 'machine learning', 'ml'],
};

/** Level words carry seniority, not role, so they are matched separately. */
const LEVEL_WORD = /^(i{1,3}|iv|[1-4]|junior|jr|senior|sr|staff|principal|lead|intern|associate|entry|level)$/;

/**
 * True when the title answers every meaningful word of the query. Words match
 * whole, except that a longer word may carry a suffix ("engineer" finds
 * "engineering"); a short one may not, or "ai" would match "Airflow".
 */
export function titleMatches(title: string, query: string): boolean {
  const t = ` ${normalize(title)} `;
  const words = normalize(query)
    .split(' ')
    .filter((w) => w && !LEVEL_WORD.test(w));
  if (!words.length) return true;
  const has = (alt: string) => t.includes(` ${alt} `) || (alt.length >= 5 && new RegExp(` ${alt}[a-z]{0,4} `).test(t));
  return words.every((w) => (own(SYNONYMS, w) ?? [w]).some(has));
}

const ALIASES: [RegExp, string[]][] = [
  [/\b(bengaluru|bangalore)\b/, ['bengaluru', 'bangalore']],
  [/\b(gurgaon|gurugram)\b/, ['gurgaon', 'gurugram']],
  [/\b(mumbai|bombay)\b/, ['mumbai', 'bombay']],
  [/\b(delhi|ncr|new delhi|noida)\b/, ['delhi', 'ncr', 'noida', 'gurgaon', 'gurugram']],
  [/\b(chennai|madras)\b/, ['chennai']],
  [/\b(kochi|cochin)\b/, ['kochi', 'cochin']],
  [/\b(trivandrum|thiruvananthapuram)\b/, ['trivandrum', 'thiruvananthapuram']],
  [/\b(mysore|mysuru)\b/, ['mysore', 'mysuru']],
];


/**
 * Whether a posting's location answers the query's. A query naming India
 * accepts any Indian city; naming a city accepts that city under either of its
 * names; saying remote accepts remote roles that are open to India. A query
 * with no place in it filters nothing.
 */
export function locationMatches(jobLocation: string, remote: boolean, wanted: string): boolean {
  const w = foldPlace(wanted);
  const loc = foldPlace(jobLocation);
  const wantsRemote = /\bremote\b|\bwfh\b|work from home/.test(w);
  const cities: string[] = [];
  for (const [re, names] of ALIASES) if (re.test(w)) cities.push(...names);
  for (const m of w.matchAll(new RegExp(INDIAN_PLACES.source, 'gi'))) {
    const p = m[0].toLowerCase();
    if (p !== 'india') cities.push(p);
  }
  const wantsIndia = /\bindia\b/.test(w);
  if (!cities.length && !wantsIndia && !wantsRemote) return true;

  const indian = INDIAN_PLACES.test(loc) || /\bind\b/.test(loc);
  if (cities.some((c) => loc.includes(c))) return true;
  if (wantsIndia && indian) return true;
  if (wantsRemote && (remote || /remote/.test(loc)) && (indian || /apac|asia|anywhere|global|worldwide/.test(loc))) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export type CompanySearch = {
  role: string;
  location: string;
  postedWithinDays: number;
  seniority: LevelWanted;
  /** Only these companies, by name. Empty searches every site. */
  companies: string[];
};

export type CompanySearchResult = {
  listings: Listing[];
  checked: number;
  failed: { name: string; ats: Ats }[];
  /** Target companies from the profile the tracker could not find a board for. */
  unmatched: string[];
};

/**
 * Board guesses for a company named in the profile: Greenhouse, Lever and
 * Ashby address boards by a slug that is usually the name, squashed. Workday
 * cannot be guessed — it needs a host and a site name — so only listed
 * Workday companies are searched.
 */
function guessSites(name: string): CareerSite[] {
  const slug = name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  if (slug.length < 2) return [];
  return (['greenhouse', 'lever', 'ashby'] as const).map((ats) => ({ name, ats, slug }));
}

const namesMatch = (a: string, b: string) => normalize(a).replace(/\s+/g, '') === normalize(b).replace(/\s+/g, '');

export async function searchCompanySites(
  req: CompanySearch,
  profileTargets: string[],
  existing: readonly Job[],
): Promise<CompanySearchResult> {
  const today = todayKey();
  const oldest = req.postedWithinDays > 0 ? shiftKey(today, -req.postedWithinDays) : null;

  // Which boards: the named companies, or everything listed plus the profile's.
  let targets: CareerSite[];
  const unmatched: string[] = [];
  const wanted = req.companies.length ? req.companies : [];
  if (wanted.length) {
    targets = [];
    for (const n of wanted) {
      const listed = CAREER_SITES.filter((s) => namesMatch(s.name, n));
      if (listed.length) targets.push(...listed);
      else targets.push(...guessSites(n));
    }
  } else {
    targets = [...CAREER_SITES];
    for (const n of profileTargets.slice(0, 15)) {
      if (!CAREER_SITES.some((s) => namesMatch(s.name, n))) targets.push(...guessSites(n));
    }
  }

  const failed: { name: string; ats: Ats }[] = [];
  const found = new Set<string>();
  const deadline = Date.now() + DEADLINE_MS;
  const results = await pool(
    targets,
    16,
    deadline,
    async (site) => {
      try {
        const rows = await boardRows(site, req.role);
        found.add(site.name);
        return rows.map((r) => ({ site, r }));
      } catch {
        // A guessed board that does not exist is expected; a listed one failing is worth saying.
        if (CAREER_SITES.includes(site)) failed.push({ name: site.name, ats: site.ats });
        return [];
      }
    },
    (site) => {
      if (CAREER_SITES.includes(site)) failed.push({ name: site.name, ats: site.ats });
      return [];
    },
  );
  for (const n of wanted.length ? wanted : profileTargets.slice(0, 15)) {
    if (![...found].some((f) => namesMatch(f, n))) unmatched.push(n);
  }

  const listings: Listing[] = [];
  const seen = new Set<string>();
  for (const { site, r } of results.flat()) {
    if (!r.title || !/^https?:\/\//.test(r.url) || seen.has(r.url)) continue;
    if (!titleMatches(r.title, req.role)) continue;
    if (!locationMatches(r.location, r.remote, req.location)) continue;
    if (oldest && r.postedOn && r.postedOn < oldest) continue;
    const seniority = seniorityOf(r.title, '');
    const listing: Listing = {
      role: r.title.replace(/\s+/g, ' ').trim(),
      company: site.name,
      location: r.location.replace(/\s+/g, ' ').trim(),
      source: SOURCE[site.ats],
      url: r.url,
      snippet: '',
      experience: '',
      salary: '',
      postedOn: r.postedOn,
      seniority,
      alreadyTracked: false,
      existingId: null,
    };
    if (!keepForLevel(listing, req.seniority)) continue;
    seen.add(r.url);
    const dup = findDuplicate({ jobUrl: r.url, applyUrl: null, company: site.name, role: listing.role, location: listing.location }, existing);
    listings.push({ ...listing, alreadyTracked: Boolean(dup), existingId: dup?.id ?? null });
  }
  // Newest first; undated last.
  listings.sort((a, b) => (b.postedOn ?? '').localeCompare(a.postedOn ?? ''));
  return { listings, checked: targets.length, failed, unmatched };
}

/** "Stripe, Razorpay\nCRED" → ["Stripe", "Razorpay", "CRED"]. */
export function companiesFrom(text: string): string[] {
  return [...new Set(text.split(/[,;\n]/).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 60))];
}
