/** Server-only transport to the existing private Workers AI gateway. */
export class CloudError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}
export const FREE_LIMIT = 'The free AI allowance or rate limit has been reached. Please retry later. The daily allowance resets at 05:30 India time; no paid fallback is enabled.';
export function cloudConfigured() { return Boolean(process.env.TUTOR_API_KEY?.trim() && process.env.TUTOR_API_URL?.trim()); }
export async function cloudRequest(path: string, body: unknown, signal?: AbortSignal) {
  const key = process.env.TUTOR_API_KEY?.trim();
  const base = process.env.TUTOR_API_URL?.trim();
  if (!key || !base) throw new CloudError('Miso’s cloud connection is not configured.', 503);
  const url = new URL(base); url.pathname = path; url.search = ''; url.hash = '';
  if (url.protocol !== 'https:') throw new CloudError('Miso’s cloud connection is invalid.', 503);
  const response = await fetch(url, {
    method: 'POST', redirect: 'error', signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new CloudError(response.status === 429 ? FREE_LIMIT : 'Miso’s cloud service could not respond. Please retry.', response.status === 429 ? 429 : 502);
  }
  return response;
}
export async function boundedJSON(req: Request, max = 80000): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw new CloudError('No message was sent.', 400);
  const decoder = new TextDecoder(); let bytes = 0, text = '';
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > max) { await reader.cancel(); throw new CloudError('This message is too large.', 413); }
      text += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (e) { if (e instanceof CloudError) throw e; throw new CloudError('The message could not be read.', 400); }
  finally { reader.releaseLock(); }
}
export function cloudFailure(e: unknown): Response {
  return Response.json({ ok: false, error: e instanceof CloudError ? e.message : 'Miso took too long to respond. Please retry.', message: e instanceof CloudError ? e.message : 'Miso took too long to respond. Please retry.' }, { status: e instanceof CloudError ? e.status : 504, headers: { 'cache-control': 'no-store' } });
}
export function sameOrigin(req: Request) { return !req.headers.get('origin') || req.headers.get('origin') === new URL(req.url).origin; }
