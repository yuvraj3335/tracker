/**
 * Company career sites and open job feeds, read through their own public job
 * APIs (server only).
 *
 * Workday, Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Oracle and
 * Amazon's own search each publish a company's open roles as JSON — no
 * browser, no crawler, no key — because that is how job boards syndicate
 * them. So this part of search runs right here on the server, and is
 * available to every AI tool, including the ones that can only reach the
 * tracker over the internet.
 *
 * Most of these answer for one company's board, so the tracker ships a list of
 * boards (data/career-sites.json, every entry checked against its API before
 * it was added) and adds the companies in the user's own profile on top. Three
 * feeds span companies instead: Workable's own job search, Himalayas (remote)
 * and Accel's portfolio board. Every request goes through ./fetch, which only
 * talks to these APIs' hosts and never follows a redirect.
 */
import data from '../../../data/career-sites.json';

import { shiftKey, todayKey } from '../date';
import { findDuplicate, own, signature, type Job } from '../jobs';
import { normalize } from '../search';
import { INDIAN_PLACES, foldPlace, keepForLevel, seniorityOf, type LevelWanted, type Listing } from './text';
import type { JobSource } from '../schema';
import { getJson } from './fetch';
import {
  readAmazon,
  readAshby,
  readGetro,
  readGreenhouse,
  readHimalayas,
  readLever,
  readOracle,
  readSmartRecruiters,
  readWorkableAccount,
  readWorkableSearch,
  readWorkday,
  workdayIndiaFacet,
  type Raw,
} from './providers';

export { workdayPosted } from './providers';

export type CareerSite =
  | { name: string; ats: 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters' | 'workable'; slug: string }
  | { name: string; ats: 'workday'; host: string; tenant: string; site: string }
  | { name: string; ats: 'oracle'; host: string; site: string }
  | { name: string; ats: 'amazon' };

/** A source that spans companies: each row names its own. */
export type JobFeed =
  | { name: string; ats: 'workable-search' | 'himalayas' }
  | { name: string; ats: 'getro'; collection: number };

type Target = CareerSite | JobFeed;
export type Ats = Target['ats'];

export const CAREER_SITES = (data as unknown as { sites: CareerSite[] }).sites;
export const JOB_FEEDS = (data as unknown as { feeds: JobFeed[] }).feeds;

const isFeed = (t: Target): t is JobFeed => t.ats === 'workable-search' || t.ats === 'himalayas' || t.ats === 'getro';

const SOURCE: Record<Ats, JobSource> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workday: 'Workday',
  smartrecruiters: 'SmartRecruiters',
  workable: 'Workable',
  oracle: 'Oracle',
  amazon: 'Company site',
  'workable-search': 'Workable',
  himalayas: 'Himalayas',
  getro: 'VC job board',
};

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/**
 * The whole search must answer inside one serverless function (60 s) with room
 * to spare, so boards not reached by this point are reported as skipped
 * rather than waited for.
 */
const DEADLINE_MS = 35_000;

/** Words only, for APIs that take the role as a filter string. */
const words = (q: string) => q.replace(/[^\p{L}\p{N} +#.-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);

async function fetchBoard(t: Target, query: string, opts: { india: boolean; entry: boolean }): Promise<Raw[]> {
  const q = words(query);
  switch (t.ats) {
    case 'greenhouse':
      return readGreenhouse(await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(t.slug)}/jobs`));
    case 'lever':
      return readLever(await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(t.slug)}?mode=json`));
    case 'ashby':
      return readAshby(await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(t.slug)}`));
    case 'workday': {
      // Workday searches server-side, so the role goes into the request. A
      // big board is asked again with its own India filter, found in the
      // first answer's facets: NVIDIA lists 1,706 matches worldwide and 140
      // in India, and the first twenty of the 1,706 are rarely Indian.
      const url = `https://${t.host}/wday/cxs/${t.tenant}/${t.site}/jobs`;
      const first = await getJson(url, { body: { appliedFacets: {}, limit: 20, offset: 0, searchText: q } });
      const facet = opts.india && Number(first?.total) > 20 ? workdayIndiaFacet(first) : null;
      const answer = facet ? await getJson(url, { body: { appliedFacets: facet, limit: 20, offset: 0, searchText: q } }) : first;
      return readWorkday(answer, t, todayKey());
    }
    case 'smartrecruiters': {
      const params = new URLSearchParams({ q, limit: '100' });
      if (opts.india) params.set('country', 'in');
      return readSmartRecruiters(await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(t.slug)}/postings?${params}`));
    }
    case 'workable':
      return readWorkableAccount(await getJson(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(t.slug)}`), t.slug);
    case 'oracle': {
      // The finder is Oracle's own mini-syntax; its separators stay literal.
      const finder = `findReqs;siteNumber=${encodeURIComponent(t.site)},keyword=${encodeURIComponent(q)}${opts.india ? ',location=India' : ''},limit=50,offset=0`;
      return readOracle(
        await getJson(
          `https://${t.host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.workLocation,requisitionList.secondaryLocations&finder=${finder}`,
        ),
        t,
      );
    }
    case 'amazon': {
      const params = new URLSearchParams({ base_query: q, result_limit: '100', offset: '0', sort: 'recent' });
      if (opts.india) params.append('normalized_country_code[]', 'IND');
      return readAmazon(await getJson(`https://www.amazon.jobs/en/search.json?${params}`));
    }
    case 'workable-search': {
      const params = new URLSearchParams({ query: q });
      if (opts.india) params.set('location', 'India');
      return readWorkableSearch(await getJson(`https://jobs.workable.com/api/v1/jobs?${params}`));
    }
    case 'himalayas': {
      const params = new URLSearchParams({ q });
      if (opts.india) params.set('country', 'India');
      if (opts.entry) params.set('seniority', 'Entry-level');
      return readHimalayas(await getJson(`https://himalayas.app/jobs/api/search?${params}`));
    }
    case 'getro':
      return readGetro(
        await getJson(`https://api.getro.com/api/v2/collections/${t.collection}/search/jobs`, {
          body: { hitsPerPage: 50, page: 0, filters: { page: 0, ...(opts.india ? { searchable_locations: ['India'] } : {}) }, query: q },
        }),
      );
  }
}

/**
 * Boards change slowly, and one job search is usually three or four roles in
 * a row, so each board's answer is kept for a few minutes. The ones that
 * search server-side are keyed by the query and its options too.
 */
const BOARD_TTL_MS = 10 * 60_000;
const boardCache = new Map<string, { at: number; rows: Raw[] }>();

/** The boards that return everything whatever the query: one cache entry each. */
const LISTS_ALL: ReadonlySet<Ats> = new Set(['greenhouse', 'lever', 'ashby', 'workable']);

function targetKey(t: Target): string {
  if ('slug' in t) return `${t.ats}:${t.slug}`;
  if (t.ats === 'workday') return `workday:${t.host}/${t.site}`;
  if (t.ats === 'oracle') return `oracle:${t.host}/${t.site}`;
  if (t.ats === 'getro') return `getro:${t.collection}`;
  return t.ats;
}

async function boardRows(t: Target, query: string, opts: { india: boolean; entry: boolean }): Promise<Raw[]> {
  const key = LISTS_ALL.has(t.ats) ? targetKey(t) : `${targetKey(t)}?${normalize(query)}|${opts.india}|${opts.entry}`;
  const hit = boardCache.get(key);
  if (hit && Date.now() - hit.at < BOARD_TTL_MS) return hit.rows;
  const rows = await fetchBoard(t, query, opts);
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
 * and Oracle cannot be guessed — they need a host and a site name — and a
 * SmartRecruiters guess always "exists" (a wrong slug answers with no jobs), so
 * only listed companies on those are searched.
 */
function guessSites(name: string): CareerSite[] {
  const slug = name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  if (slug.length < 2) return [];
  return (['greenhouse', 'lever', 'ashby'] as const).map((ats) => ({ name, ats, slug }));
}

const namesMatch = (a: string, b: string) => normalize(a).replace(/\s+/g, '') === normalize(b).replace(/\s+/g, '');

/** "hosur road bangalore, , India" → "hosur road bangalore, India". */
export const tidyPlace = (s: string) =>
  s.replace(/\s+/g, ' ').replace(/\s*,(\s*,)+/g, ',').replace(/\s*,\s*/g, ', ').replace(/^[,\s]+|[,\s]+$/g, '').trim();

/** A search is for India unless it names somewhere else: the list is companies hiring in India. */
function wantsIndia(location: string): boolean {
  const w = foldPlace(location);
  return !w.trim() || INDIAN_PLACES.test(w) || /\bremote\b|\bwfh\b|\bind\b/.test(w);
}

export async function searchCompanySites(
  req: CompanySearch,
  profileTargets: string[],
  existing: readonly Job[],
): Promise<CompanySearchResult> {
  const today = todayKey();
  const oldest = req.postedWithinDays > 0 ? shiftKey(today, -req.postedWithinDays) : null;
  const opts = { india: wantsIndia(req.location), entry: req.seniority === 'entry' };

  // Which boards: the named companies, or everything listed plus the
  // profile's, plus the feeds. Naming companies skips the feeds: they are not
  // one company, and the named ones are what was asked for.
  let targets: Target[];
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
    targets = [...CAREER_SITES, ...JOB_FEEDS];
    for (const n of profileTargets.slice(0, 15)) {
      if (!CAREER_SITES.some((s) => namesMatch(s.name, n))) targets.push(...guessSites(n));
    }
  }
  const listed = (t: Target) => isFeed(t) || CAREER_SITES.includes(t);

  const failed: { name: string; ats: Ats }[] = [];
  const found = new Set<string>();
  const deadline = Date.now() + DEADLINE_MS;
  const results = await pool(
    targets,
    16,
    deadline,
    async (t) => {
      try {
        const rows = await boardRows(t, req.role, opts);
        if (!isFeed(t)) found.add(t.name);
        return rows.map((r) => ({ t, r }));
      } catch {
        // A guessed board that does not exist is expected; a listed one failing is worth saying.
        if (listed(t)) failed.push({ name: t.name, ats: t.ats });
        return [];
      }
    },
    (t) => {
      if (listed(t)) failed.push({ name: t.name, ats: t.ats });
      return [];
    },
  );

  const listings: Listing[] = [];
  const seen = new Set<string>();
  const seenRole = new Set<string>();
  for (const { t, r } of results.flat()) {
    if (!r.title || !/^https?:\/\//.test(r.url) || seen.has(r.url)) continue;
    if (!titleMatches(r.title, req.role)) continue;
    if (!locationMatches(r.location, r.remote, req.location)) continue;
    if (oldest && r.postedOn && r.postedOn < oldest) continue;
    const company = (isFeed(t) ? r.company : t.name)?.replace(/\s+/g, ' ').trim() ?? '';
    if (!company) continue;
    const experience = r.experience ?? '';
    // The title's own "Senior" or "Intern" wins over the API's level: a
    // company's "entry level" tag on a "Sr. Engineer" posting is a data slip.
    const fromTitle = seniorityOf(r.title, experience);
    const listing: Listing = {
      role: r.title.replace(/\s+/g, ' ').trim(),
      company,
      location: tidyPlace(r.location),
      source: SOURCE[t.ats],
      url: r.url,
      snippet: '',
      experience,
      salary: '',
      postedOn: r.postedOn,
      seniority: fromTitle === 'senior' || fromTitle === 'intern' ? fromTitle : (r.level ?? fromTitle),
      alreadyTracked: false,
      existingId: null,
    };
    if (!keepForLevel(listing, req.seniority)) continue;
    // A feed often repeats a company's own board under another URL, so a feed
    // row whose role, company and city a board already showed is dropped.
    // Two board rows are never merged this way: one company posting the same
    // title in the same city twice (JPMorgan does, often) is two openings.
    const sig = signature(listing);
    if (isFeed(t) && seenRole.has(sig)) continue;
    seen.add(r.url);
    seenRole.add(sig);
    found.add(company);
    const dup = findDuplicate({ jobUrl: r.url, applyUrl: null, company, role: listing.role, location: listing.location }, existing);
    listings.push({ ...listing, alreadyTracked: Boolean(dup), existingId: dup?.id ?? null });
  }
  for (const n of wanted.length ? wanted : profileTargets.slice(0, 15)) {
    if (![...found].some((f) => namesMatch(f, n))) unmatched.push(n);
  }
  // Newest first; undated last.
  listings.sort((a, b) => (b.postedOn ?? '').localeCompare(a.postedOn ?? ''));
  return { listings, checked: targets.length, failed, unmatched };
}

/** "Stripe, Razorpay\nCRED" → ["Stripe", "Razorpay", "CRED"]. */
export function companiesFrom(text: string): string[] {
  return [...new Set(text.split(/[,;\n]/).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 60))];
}
