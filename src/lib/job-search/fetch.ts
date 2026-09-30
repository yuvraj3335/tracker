/**
 * The one way the server fetches from job sites (server only).
 *
 * Every request goes to a host on the list below, over https, without
 * following redirects. The addresses are built from ids read out of posting
 * URLs and from data/career-sites.json, and a posting URL saved in Notion can
 * hold anything — so the host is checked here, at the last moment, rather than
 * trusted from wherever the URL was put together. None of these APIs
 * redirects (each was checked), so a redirect is treated as a failure instead
 * of being followed somewhere unchecked.
 */

const HOSTS: RegExp[] = [
  /^boards-api\.greenhouse\.io$/,
  /^api\.lever\.co$/,
  /^api\.eu\.lever\.co$/,
  /^api\.ashbyhq\.com$/,
  /^[a-z0-9-]{1,63}\.wd\d{1,3}\.myworkdayjobs\.com$/,
  /^api\.smartrecruiters\.com$/,
  /^www\.amazon\.jobs$/,
  /^[a-z0-9-]{1,63}\.fa(\.[a-z0-9-]{1,30})?\.oraclecloud\.com$/,
  /^apply\.workable\.com$/,
  /^jobs\.workable\.com$/,
  /^himalayas\.app$/,
  /^api\.getro\.com$/,
];

export function allowedJobApi(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && HOSTS.some((re) => re.test(u.hostname.toLowerCase()));
  } catch {
    return false;
  }
}

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 12_000;

/**
 * JSON from a job API, or a FetchError carrying the HTTP status — callers tell
 * "not found" (a closed posting) from "could not reach" (try again) by it.
 */
export async function getJson(url: string, opts: { body?: unknown; timeoutMs?: number } = {}): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!allowedJobApi(url)) throw new FetchError('not a job API this tracker reads', null);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: opts.body ? 'POST' : 'GET',
      signal: abort.signal,
      redirect: 'error',
      headers: { accept: 'application/json', ...(opts.body ? { 'content-type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
    });
    if (!res.ok) throw new FetchError(`HTTP ${res.status}`, res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
