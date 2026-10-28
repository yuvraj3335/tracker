import { currentUser } from '@/lib/tenant';
import { createRateLimiter, retryAfterSeconds } from '@/lib/rate-limit';
import { parseTutorInput, withStudyContext } from '@/lib/tutor';
import { searchReferences } from '@/lib/tutor-search';

export const runtime = 'nodejs';
export const maxDuration = 60;
const take = createRateLimiter(20, 5 * 60000);
const fail = (status: number, error: string) => Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } });

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail(401, 'Sign in to use your study tutor.');
  if (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url).origin) return fail(403, 'Open the tutor in your tracker.');
  const key = process.env.TUTOR_API_KEY?.trim();
  const endpoint = process.env.TUTOR_API_URL?.trim();
  if (!key || !endpoint) return fail(503, 'The study tutor is awaiting deployment setup.');
  const rate = take(user.id);
  if (!rate.allowed) return Response.json({ error: 'Please pause before asking more questions.' }, { status: 429, headers: { 'retry-after': String(retryAfterSeconds(rate.retryAfterMs)), 'cache-control': 'no-store' } });
  if (!req.headers.get('content-type')?.startsWith('application/json')) return fail(415, 'Send a JSON conversation.');
  // Enforce on streamed bytes, not an untrusted Content-Length header.
  let input;
  const reader = req.body?.getReader();
  if (!reader) return fail(400, 'No question was sent.');
  try {
    const decoder = new TextDecoder();
    let bytes = 0, text = '';
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 150000) { await reader.cancel(); return fail(413, 'This conversation is too large. Start a new chat.'); }
      text += decoder.decode(part.value, { stream: true });
    }
    input = parseTutorInput(JSON.parse(text + decoder.decode()));
  } catch { return fail(400, 'The conversation could not be read.'); }
  finally { reader.releaseLock(); }
  if (!input) return fail(400, 'Keep each message under 8,000 characters and start a new chat when it gets too long.');

  const abort = new AbortController();
  const onCancel = () => abort.abort();
  req.signal.addEventListener('abort', onCancel, { once: true });
  const timeout = setTimeout(() => abort.abort(), 55000);
  const release = () => { clearTimeout(timeout); req.signal.removeEventListener('abort', onCancel); };
  try {
    const search = input.search ? await searchReferences(input.search, AbortSignal.any([abort.signal, AbortSignal.timeout(7000)])) : { references: [], warning: null };
    const response = await fetch(endpoint, { method: 'POST', signal: abort.signal, redirect: 'error', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ messages: withStudyContext(input, search.references) }) });
    if (!response.ok || !response.body) {
      release();
      return fail(response.status === 429 ? 429 : 502, response.status === 429 ? 'The free AI allowance or rate limit has been reached. Retry later. The daily allowance resets at 05:30 India time; there is no paid fallback.' : 'The tutor could not be reached. Please try again.');
    }
    const upstream = response.body.getReader();
    const encoder = new TextEncoder();
    let cancelled = false;
    return new Response(new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'sources', ...search }) + '\n'));
        try {
          for (;;) { const part = await upstream.read(); if (part.done || cancelled) break; controller.enqueue(part.value); }
        } catch { if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', message: 'The answer was interrupted. Please retry.' }) + '\n')); }
        finally { release(); upstream.releaseLock(); if (!cancelled) controller.close(); }
      },
      cancel() { cancelled = true; release(); abort.abort(); return upstream.cancel(); },
    }), { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
  } catch {
    release();
    return fail(504, 'The tutor took too long to respond. Please retry.');
  }
}
