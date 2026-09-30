/**
 * Is a posting still open, asked of its board's own API (server only).
 *
 * Only boards that answer per posting are asked here — Greenhouse, Lever,
 * Ashby, Workday, SmartRecruiters and Workable. LinkedIn, Naukri and company
 * pages need the page itself, which only the local connector's browser can
 * read (see ./liveness for how a page is read).
 *
 * The signals are career-ops's (liveness-api.mjs, MIT), and all of them lean
 * the same way: a wrong Closed hides a real job, so an API only says Closed
 * when it is unambiguous. A 404 counts on Greenhouse and Workday only when
 * the board itself still answers with jobs (a board that is gone, or a guess
 * at the wrong board, 404s too). Lever 404s confidential postings that are
 * still open, and Ashby and Workable leave unlisted ones out of their lists,
 * so on those three "not found" means "read the page", never "closed".
 */
import { FetchError, getJson } from './fetch';
import { postingRef, type LivenessResult, type PostingRef } from './liveness';
import { CAREER_SITES } from './career-sites';
import { normalize } from '../search';

const LABEL: Record<PostingRef['ats'], string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workday: 'Workday',
  smartrecruiters: 'SmartRecruiters',
  workable: 'Workable',
};

const enc = encodeURIComponent;
const open = (ats: PostingRef['ats']): LivenessResult => ({ state: 'Open', reason: `${LABEL[ats]} still lists it` });
const is404 = (e: unknown) => e instanceof FetchError && (e.status === 404 || e.status === 410);

/** Null when the board cannot settle it and the page has to be read. */
async function ask(ref: PostingRef, timeoutMs: number): Promise<LivenessResult | null> {
  switch (ref.ats) {
    case 'greenhouse':
      try {
        await getJson(`https://boards-api.greenhouse.io/v1/boards/${enc(ref.board)}/jobs/${ref.id}`, { timeoutMs });
        return open(ref.ats);
      } catch (e) {
        if (!is404(e)) throw e;
        const board = await getJson(`https://boards-api.greenhouse.io/v1/boards/${enc(ref.board)}/jobs`, { timeoutMs });
        return Array.isArray(board?.jobs) && board.jobs.length
          ? { state: 'Closed', reason: 'Greenhouse no longer has it on a board that is still hiring' }
          : { state: 'Unclear', reason: 'the Greenhouse board did not answer with jobs' };
      }
    case 'workday': {
      const base = `https://${ref.host}/wday/cxs/${ref.tenant}/${enc(ref.site)}`;
      try {
        await getJson(`${base}/job/${ref.path.split('/').map(enc).join('/')}`, { timeoutMs });
        return open(ref.ats);
      } catch (e) {
        if (!is404(e)) throw e;
        const board = await getJson(`${base}/jobs`, { timeoutMs, body: { appliedFacets: {}, limit: 1, offset: 0, searchText: '' } });
        return Number(board?.total) > 0
          ? { state: 'Closed', reason: 'Workday no longer has it on a board that is still hiring' }
          : { state: 'Unclear', reason: 'the Workday board did not answer with jobs' };
      }
    }
    case 'smartrecruiters': {
      const j = await getJson(`https://api.smartrecruiters.com/v1/companies/${enc(ref.company)}/postings/${ref.id}`, { timeoutMs });
      return j?.active === false ? { state: 'Closed', reason: 'SmartRecruiters marks it inactive' } : open(ref.ats);
    }
    case 'lever':
      try {
        await getJson(`https://api.lever.co/v0/postings/${enc(ref.slug)}/${ref.id}`, { timeoutMs });
        return open(ref.ats);
      } catch (e) {
        if (is404(e)) return null;
        throw e;
      }
    case 'ashby': {
      const j = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${enc(ref.org)}`, { timeoutMs });
      const jobs: any[] = Array.isArray(j?.jobs) ? j.jobs : []; // eslint-disable-line @typescript-eslint/no-explicit-any
      const hit = jobs.some((x) => String(x?.id).toLowerCase() === ref.id || String(x?.jobUrl ?? '').toLowerCase().includes(ref.id));
      return hit ? open(ref.ats) : null;
    }
    case 'workable': {
      const j = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${enc(ref.account)}`, { timeoutMs });
      const jobs: any[] = Array.isArray(j?.jobs) ? j.jobs : []; // eslint-disable-line @typescript-eslint/no-explicit-any
      return jobs.some((x) => String(x?.shortcode).toUpperCase() === ref.shortcode) ? open(ref.ats) : null;
    }
  }
}

/**
 * A Greenhouse posting shown on the company's own site ("stripe.com/jobs/
 * search?gh_jid=8209970") names the job but not the board. For a company on
 * the tracker's list, the board is known.
 */
function greenhouseOnCompanySite(url: string | null | undefined, company: string): PostingRef | null {
  if (!url) return null;
  let id: string | null = null;
  try {
    id = new URL(url).searchParams.get('gh_jid');
  } catch {
    return null;
  }
  if (!id || !/^\d{4,15}$/.test(id)) return null;
  const name = normalize(company).replace(/\s+/g, '');
  const site = CAREER_SITES.find((s) => s.ats === 'greenhouse' && normalize(s.name).replace(/\s+/g, '') === name);
  return site && 'slug' in site ? { ats: 'greenhouse', board: site.slug, id } : null;
}

/**
 * The state of one posting by its board's API, or null when its link is not
 * on a board with one — then only reading the page can tell.
 */
export async function checkPostingApi(
  url: string | null | undefined,
  company = '',
  opts: { timeoutMs?: number } = {},
): Promise<LivenessResult | null> {
  const ref = postingRef(url) ?? greenhouseOnCompanySite(url, company);
  if (!ref) return null;
  try {
    return await ask(ref, opts.timeoutMs ?? 12_000);
  } catch (e) {
    const status = e instanceof FetchError ? e.status : null;
    if (status === 403 || status === 429) return { state: 'Blocked', reason: `${LABEL[ref.ats]} refused the check (${status})` };
    return { state: 'Unclear', reason: status ? `${LABEL[ref.ats]} answered ${status}` : `${LABEL[ref.ats]} could not be reached` };
  }
}
