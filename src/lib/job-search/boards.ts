/**
 * The job boards, and which page to open on each for a search.
 *
 * The tracker never crawls anything itself — it runs on Vercel, where there is
 * no browser, and Crawl4AI runs on the user's machine, which Vercel cannot
 * reach. So a board search is split in two:
 *
 *   plan   here     which page to open on each board, for this role and place
 *   crawl  local    the Job Hunt connector opens those pages with Crawl4AI
 *   read   read.ts  the rendered pages come back and are read into listings
 *
 * Both ends that need knowledge of the boards live in this folder, tested; the
 * connector only moves pages.
 */
import type { JobSource } from '../schema';
import { own } from '../jobs';
import { primaryPlace, slug, titleCase } from './text';

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
      const params = new URLSearchParams();
      if (q.postedWithinDays > 0) params.set('fromAge', String(Math.min(q.postedWithinDays, 30)));
      if (p.remote) params.set('remoteWorkType', '1');
      const qs = params.size ? `?${params}` : '';
      return {
        url: glassdoorSearchUrl(q.role, p.city) + qs,
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

/**
 * Glassdoor's own slug and location id, for the cities they are known for —
 * taken from a Glassdoor search page that loaded, not guessed.
 */
const GLASSDOOR_CITY: Record<string, { slug: string; id: string }> = { bengaluru: { slug: 'bangalore', id: 'IC2940587' } };

/**
 * Glassdoor's canonical search address. The simple `jobs.htm?sc.keyword=…`
 * form redirects to a generic India page and drops every filter on the way —
 * measured: all 30 results came back "30d+" old. The canonical form keeps
 * them: `<place>-<role>-jobs-SRCH_IL.<place span>_<place id>_KO<role span>.htm`,
 * where the spans are character offsets into the slug.
 */
export function glassdoorSearchUrl(role: string, city: string | null): string {
  const known = city ? own(GLASSDOOR_CITY, city) : undefined;
  const id = known?.id;
  const place = known?.slug ?? 'india';
  const what = slug(role);
  const il = `0,${place.length}`;
  const ko = `${place.length + 1},${place.length + 1 + what.length}`;
  return `https://www.glassdoor.co.in/Job/${place}-${what}-jobs-SRCH_IL.${il}_${id ?? 'IN115'}_KO${ko}.htm`;
}
export function planBoardSearch(q: BoardQuery, boards: readonly BoardId[] = BOARD_IDS): PagePlan[] {
  return BOARDS.filter((b) => boards.includes(b.id)).map((b) => ({ board: b.id, ...b.plan(q) }));
}

export const boardOf = (id: string) => BOARDS.find((b) => b.id === id);
