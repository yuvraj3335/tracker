/**
 * Each job API's answer, read into one shape. Pure: the JSON comes in, rows go
 * out, so every reader is tested against a saved answer without a network.
 *
 * Which providers, and what each one's fields mean, came from measuring them
 * and from career-ops's provider notes (providers/*.mjs, MIT): SmartRecruiters
 * says any slug exists (a wrong one answers 200 with no jobs), Workday nests
 * its India filter in the facets of the first answer, Himalayas' plain feed is
 * a page of 94,000, and so on.
 */
import { shiftKey, type DayKey } from '../date';
import { experienceFromText, postedFromText, type Seniority } from './text';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** One posting from a job API, before any filtering. */
export type Raw = {
  title: string;
  location: string;
  url: string;
  postedOn: DayKey | null;
  remote: boolean;
  /** For feeds that span companies; a company board leaves it out. */
  company?: string;
  /** Years asked, when the API states them ("3+ yrs"). */
  experience?: string;
  /** The API's own level, when it has one. Wins over reading the title. */
  level?: Seniority;
};

const str = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

export const day = (v: unknown): DayKey | null => {
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Seconds or milliseconds since 1970 — the two feeds here use one each.
    const ms = v < 1e12 ? v * 1000 : v;
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "September 30, 2026" → 2026-09-30, without trusting Date to parse English. */
export function dayFromWords(s: string): DayKey | null {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** Workday writes "Posted Today", "Posted Yesterday", "Posted 3 Days Ago", "Posted 30+ Days Ago". */
export function workdayPosted(text: string, today: DayKey): DayKey | null {
  const s = text.toLowerCase();
  if (/today/.test(s)) return today;
  if (/yesterday/.test(s)) return shiftKey(today, -1);
  // "30+ Days Ago" reads as 30 days ago: a floor, but one that keeps an old
  // posting out of a "this week" search, which an unknown date would not.
  return postedFromText(s.replace(/^posted\s+/, ''), today);
}

const has = (s: string, re: RegExp) => re.test(s);

// ---------------------------------------------------------------------------
// Company boards
// ---------------------------------------------------------------------------

export function readGreenhouse(j: any): Raw[] {
  return (Array.isArray(j?.jobs) ? j.jobs : []).map((x: any) => {
    const location = str(x?.location?.name);
    return { title: str(x?.title), location, url: str(x?.absolute_url), postedOn: day(x?.first_published) ?? day(x?.updated_at), remote: has(location, /remote/i) };
  });
}

export function readLever(j: any): Raw[] {
  return (Array.isArray(j) ? j : []).map((x: any) => {
    const locs = [x?.categories?.location, ...(x?.categories?.allLocations ?? [])].filter(Boolean).map(str);
    return {
      title: str(x?.text),
      location: [...new Set(locs)].join(' / '),
      url: str(x?.hostedUrl),
      postedOn: day(x?.createdAt),
      remote: x?.workplaceType === 'remote' || has(locs.join(' '), /remote/i),
    };
  });
}

export function readAshby(j: any): Raw[] {
  return (Array.isArray(j?.jobs) ? j.jobs : [])
    .filter((x: any) => x?.isListed !== false)
    .map((x: any) => {
      const locs = [x?.location, ...(x?.secondaryLocations ?? []).map((s: any) => s?.location)].filter(Boolean).map(str);
      return {
        title: str(x?.title),
        location: [...new Set(locs)].join(' / '),
        url: str(x?.jobUrl),
        postedOn: day(x?.publishedAt),
        remote: x?.isRemote === true || has(str(x?.workplaceType), /remote/i),
      };
    });
}

export function readWorkday(j: any, site: { host: string; site: string }, today: DayKey): Raw[] {
  return (Array.isArray(j?.jobPostings) ? j.jobPostings : []).map((x: any) => {
    const location = str(x?.locationsText);
    return {
      title: str(x?.title),
      location,
      url: `https://${site.host}/${site.site}${str(x?.externalPath)}`,
      postedOn: workdayPosted(str(x?.postedOn), today),
      remote: has(location, /remote/i),
    };
  });
}

/**
 * Workday's own India filter, from the facets the first answer carries: a
 * value named "India" in any location facet, however deeply the tenant nests
 * it. NVIDIA's board is 1,706 software postings worldwide and 140 in India,
 * so asking for India up front is what lets the search reach them at all.
 */
export function workdayIndiaFacet(j: any): Record<string, string[]> | null {
  const stack: any[] = Array.isArray(j?.facets) ? [...j.facets] : [];
  const found: { param: string; id: string }[] = [];
  while (stack.length) {
    const f = stack.shift();
    const param = str(f?.facetParameter);
    const values: any[] = Array.isArray(f?.values) ? f.values : [];
    for (const v of values) {
      if (Array.isArray(v?.values)) stack.push(v);
      else if (/^india$/i.test(str(v?.descriptor).trim()) && param && /location|country/i.test(param) && str(v?.id)) {
        found.push({ param, id: str(v.id) });
      }
    }
  }
  // A country facet beats a site called "India": the site is one office, and
  // filtering to it would drop the others.
  const best = found.find((f) => /country|hierarchy/i.test(f.param)) ?? found[0];
  return best ? { [best.param]: [best.id] } : null;
}

/**
 * SmartRecruiters' own levels. "mid_senior_level" is left out on purpose: it
 * is the level most postings carry, whatever they are, so the title decides.
 */
const SR_LEVEL: Record<string, Seniority> = {
  internship: 'intern',
  entry_level: 'entry',
  associate: 'entry',
  director: 'senior',
  executive: 'senior',
};

export function readSmartRecruiters(j: any): Raw[] {
  return (Array.isArray(j?.content) ? j.content : []).map((x: any) => {
    const loc = x?.location ?? {};
    const level = Object.prototype.hasOwnProperty.call(SR_LEVEL, str(x?.experienceLevel?.id)) ? SR_LEVEL[str(x?.experienceLevel?.id)] : undefined;
    const company = str(x?.company?.identifier);
    return {
      title: str(x?.name),
      location: str(loc.fullLocation) || [loc.city, loc.region, loc.country].filter(Boolean).map(str).join(', '),
      url: company && /^\d{6,20}$/.test(str(x?.id)) ? `https://jobs.smartrecruiters.com/${encodeURIComponent(company)}/${str(x?.id)}` : '',
      postedOn: day(x?.releasedDate),
      remote: loc.remote === true,
      ...(level ? { level } : {}),
    };
  });
}

/** Amazon's own search: its basic qualifications state the years, so the level is read from them. */
export function readAmazon(j: any): Raw[] {
  return (Array.isArray(j?.jobs) ? j.jobs : []).map((x: any) => {
    const quals = str(x?.basic_qualifications).replace(/<br\s*\/?>/gi, '\n');
    const student = x?.is_intern === true || x?.university_job === true;
    return {
      title: str(x?.title),
      location: str(x?.normalized_location) || str(x?.location),
      url: /^\/[A-Za-z0-9/_-]+$/.test(str(x?.job_path)) ? `https://www.amazon.jobs${str(x?.job_path)}` : '',
      postedOn: dayFromWords(str(x?.posted_date)),
      remote: false,
      experience: experienceFromText(quals),
      ...(student ? { level: 'entry' as Seniority } : {}),
    };
  });
}

/** Oracle Recruiting Cloud (JPMorgan and other banks): one search, the requisitions inside it. */
export function readOracle(j: any, site: { host: string; site: string }): Raw[] {
  const reqs: any[] = (Array.isArray(j?.items) ? j.items : []).flatMap((i: any) => (Array.isArray(i?.requisitionList) ? i.requisitionList : []));
  return reqs.map((x: any) => {
    const workplace = str(x?.WorkplaceTypeCode ?? x?.WorkplaceType);
    return {
      title: str(x?.Title),
      location: str(x?.PrimaryLocation),
      url: /^\d+$/.test(str(x?.Id)) ? `https://${site.host}/hcmUI/CandidateExperience/en/sites/${encodeURIComponent(site.site)}/job/${str(x?.Id)}` : '',
      postedOn: day(x?.PostedDate),
      remote: /remote/i.test(workplace),
    };
  });
}

/** One company's Workable board. The URL keeps the account, so a later liveness check can find it. */
export function readWorkableAccount(j: any, account: string): Raw[] {
  return (Array.isArray(j?.jobs) ? j.jobs : []).map((x: any) => {
    const locs = (Array.isArray(x?.locations) && x.locations.length ? x.locations : [x]).map((l: any) =>
      [l?.city, l?.region ?? l?.state, l?.country].filter(Boolean).map(str).join(', '),
    );
    const code = str(x?.shortcode);
    return {
      title: str(x?.title),
      location: [...new Set(locs.filter(Boolean))].join(' / '),
      url: /^[A-Za-z0-9]{6,16}$/.test(code) ? `https://apply.workable.com/${encodeURIComponent(account)}/j/${code}/` : '',
      postedOn: day(x?.published_on) ?? day(x?.created_at),
      remote: x?.telecommuting === true,
    };
  });
}

// ---------------------------------------------------------------------------
// Feeds across companies
// ---------------------------------------------------------------------------

/** Workable's job search: every company on Workable at once, filtered to India by the query. */
export function readWorkableSearch(j: any): Raw[] {
  return (Array.isArray(j?.jobs) ? j.jobs : []).map((x: any) => ({
    title: str(x?.title),
    location: (Array.isArray(x?.locations) ? x.locations.map(str) : []).join(' / ') || [x?.location?.city, x?.location?.subregion, x?.location?.countryName].filter(Boolean).map(str).join(', '),
    url: /^https:\/\/jobs\.workable\.com\//.test(str(x?.url)) ? str(x?.url) : '',
    postedOn: day(x?.created),
    remote: x?.workplace === 'remote',
    company: str(x?.company?.title),
  }));
}

/** Himalayas: remote jobs, the search already narrowed to ones open to India. */
export function readHimalayas(j: any): Raw[] {
  return (Array.isArray(j?.jobs) ? j.jobs : []).map((x: any) => {
    const where = (Array.isArray(x?.locationRestrictions) ? x.locationRestrictions : []).map((l: any) => str(l?.name ?? l)).filter(Boolean);
    const seniority = (Array.isArray(x?.seniority) ? x.seniority : [x?.seniority]).map(str).join(' ').toLowerCase();
    return {
      title: str(x?.title),
      location: where.length ? `Remote (${where.slice(0, 4).join(', ')})` : 'Remote',
      url: /^https:\/\/himalayas\.app\//.test(str(x?.applicationLink)) ? str(x?.applicationLink) : '',
      postedOn: day(x?.pubDate),
      remote: true,
      company: str(x?.companyName),
      ...(/entry|junior|intern/.test(seniority) ? { level: (/intern/.test(seniority) ? 'intern' : 'entry') as Seniority } : {}),
    };
  });
}

/**
 * A VC firm's portfolio job board (Getro): the firm's companies' postings,
 * each pointing at the company's own careers page — which is also what makes
 * them easy to trust.
 */
export function readGetro(j: any): Raw[] {
  const jobs: any[] = Array.isArray(j?.results?.jobs) ? j.results.jobs : [];
  return jobs.map((x: any) => {
    const locs = (Array.isArray(x?.locations) ? x.locations : []).map(str);
    const indian = locs.filter((l: string) => /india|bengaluru|bangalore|hyderabad|pune|chennai|mumbai|delhi|gurgaon|gurugram|noida/i.test(l));
    return {
      title: str(x?.title),
      location: (indian.length ? indian : locs).slice(0, 3).join(' / '),
      url: /^https:\/\//.test(str(x?.url)) ? str(x?.url) : '',
      postedOn: day(x?.created_at),
      remote: x?.work_mode === 'remote',
      company: str(x?.organization?.name),
    };
  });
}
