import type { Reference } from './tutor';

export function plainText(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

// Public, documented APIs with no key or paid fallback. Only the explicitly
// entered search phrase is transmitted, never the conversation or pasted code.
export async function searchReferences(query: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<{ references: Reference[]; warning: string | null }> {
  const results = await Promise.allSettled([
    (async (): Promise<Reference[]> => {
      const url = new URL('https://en.wikipedia.org/w/api.php');
      url.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: '3', format: 'json', utf8: '1' }).toString();
      const res = await fetcher(url, { signal, headers: { 'User-Agent': 'TrackerStudyTutor/1.0 (https://github.com/yuvraj3335/tracker)' } });
      if (!res.ok) throw new Error('Wikipedia unavailable');
      const data = await res.json();
      if (!Array.isArray(data.query?.search)) throw new Error('Invalid Wikipedia response');
      return data.query.search.filter((r: { title?: unknown; snippet?: unknown }) => typeof r.title === 'string' && typeof r.snippet === 'string').slice(0, 3).map((r: { title: string; snippet: string }) => ({ title: r.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`, excerpt: plainText(r.snippet).slice(0, 700) }));
    })(),
    (async (): Promise<Reference[]> => {
      const url = new URL('https://api.stackexchange.com/2.3/search/advanced');
      url.search = new URLSearchParams({ site: 'stackoverflow', q: query, pagesize: '3', sort: 'relevance', order: 'desc', filter: 'withbody' }).toString();
      const res = await fetcher(url, { signal });
      if (!res.ok) throw new Error('Stack Overflow unavailable');
      const data = await res.json();
      if (!Array.isArray(data.items) || data.error_id || data.backoff) throw new Error('Stack Overflow rate limited');
      return data.items.filter((r: { link?: unknown; title?: unknown; body?: unknown }) => typeof r.link === 'string' && /^https:\/\/stackoverflow\.com\/questions\/\d+\//.test(r.link) && typeof r.title === 'string' && typeof r.body === 'string').slice(0, 3).map((r: { title: string; link: string; body: string }) => ({ title: plainText(r.title), url: r.link, excerpt: plainText(r.body).slice(0, 700) }));
    })(),
  ]);
  const references = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  const failed = results.some(r => r.status === 'rejected');
  return { references, warning: !references.length ? 'No references were retrieved. This answer uses the model’s knowledge.' : failed ? 'One reference source is unavailable. Available sources are shown below.' : null };
}
