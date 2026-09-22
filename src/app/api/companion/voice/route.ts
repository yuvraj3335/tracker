import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/tenant';
import { createRateLimiter, retryAfterSeconds } from '@/lib/rate-limit';
import { MAX_REPLY_CHARS } from '@/lib/companion-prompt';

/**
 * Speech, from somewhere with a GPU.
 *
 * The model that runs in the browser generates speech slightly slower than
 * the speech is spoken, which is why there is still a pause after a full stop
 * on a machine without a usable GPU. A hosted engine answers in a few hundred
 * milliseconds and removes the pause outright.
 *
 * It is off unless somebody turns it on, and turning it on is setting a key.
 * That is the consent: it costs money per reply and it sends text to a third
 * party, and neither of those is a decision this code gets to make on an
 * owner's behalf. With no key the route answers "not configured" and the
 * companion goes on using the model in the browser, exactly as before.
 *
 * What is sent is the companion's own words and nothing else. The person's
 * side of the conversation never reaches this route — only the reply that is
 * about to be read out loud.
 *
 * The shape is OpenAI's `/audio/speech`, which several providers implement,
 * so `TTS_BASE_URL` is usually all that has to change to point it elsewhere.
 */
export const runtime = 'nodejs';
/** A line at a time, and the caller is waiting to hear it. */
export const maxDuration = 20;

const DEFAULT_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'tts-1';
const DEFAULT_VOICE = 'alloy';
const TIMEOUT_MS = 12_000;

/**
 * Generous, because this is called once per sentence rather than once per
 * reply — but still a ceiling, for the same reason the chat route has one:
 * it spends a billed key and a loop in the client must not be able to empty
 * an account.
 */
const take = createRateLimiter(240, 5 * 60_000);

const COPY = {
  signedOut: 'Sign in to talk to your companion.',
  notConfigured: 'No hosted voice is configured on this deployment.',
  badRequest: 'There was nothing to say.',
  tooMany: 'Give the voice a moment to catch up.',
  upstream: 'The hosted voice could not be reached just now.',
} as const;

const setting = (key: string, fallback: string) => process.env[key]?.trim() || fallback;

/** Whether an owner has turned this on. Read in one place. */
const apiKey = () => process.env.TTS_API_KEY?.trim();

const fail = (status: number, message: string) =>
  NextResponse.json({ ok: false, message }, { status });

/**
 * Whether the client should offer a hosted voice at all.
 *
 * Signed in, because everything here is, and because the answer reveals what
 * this deployment is configured with. It never returns the key or the
 * provider — only whether there is one.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return fail(401, COPY.signedOut);
  return NextResponse.json({ ok: true, configured: Boolean(apiKey()) });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail(401, COPY.signedOut);

  const key = apiKey();
  // 200 rather than an error: the feature is simply not turned on here, which
  // is a state the panel renders rather than a fault.
  if (!key) return NextResponse.json({ ok: false, message: COPY.notConfigured, configured: false });

  const limit = take(user.id);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, message: COPY.tooMany },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds(limit.retryAfterMs)) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, COPY.badRequest);
  }
  const raw = (body as { text?: unknown } | null)?.text;
  const text = typeof raw === 'string' ? raw.trim().slice(0, MAX_REPLY_CHARS) : '';
  if (!text) return fail(400, COPY.badRequest);

  const asked = Number((body as { speed?: unknown } | null)?.speed);
  // The provider's own range, not ours. Anything outside it is a client bug
  // and is better clamped than passed on to be rejected.
  const speed = Number.isFinite(asked) ? Math.min(4, Math.max(0.25, asked)) : 1;

  const url = `${setting('TTS_BASE_URL', DEFAULT_BASE).replace(/\/$/, '')}/audio/speech`;
  const send = (payload: Record<string, unknown>) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  const base = {
    model: setting('TTS_MODEL', DEFAULT_MODEL),
    voice: setting('TTS_VOICE', DEFAULT_VOICE),
    input: text,
    // Uncompressed on purpose. The client trims the silence off each clip and
    // schedules the next one against the audio clock, and a compressed format
    // carries encoder padding that would be indistinguishable from speech —
    // which is the difference between a chosen pause and a smeared one.
    response_format: 'wav',
  };

  try {
    let upstream = await send({ ...base, speed });
    // Not every model takes a speed. One retry without it beats a silent
    // companion because of a model name in an environment variable.
    if (upstream.status === 400) upstream = await send(base);

    if (!upstream.ok || !upstream.body) return fail(502, COPY.upstream);

    const audio = await upstream.arrayBuffer();
    if (!audio.byteLength) return fail(502, COPY.upstream);

    return new NextResponse(audio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(audio.byteLength),
        // Said once, to one person, and never worth a cache anywhere between
        // here and them.
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    // Nothing upstream is ever quoted back — not its status text, not its
    // body. The same rule the chat route follows.
    return fail(502, COPY.upstream);
  }
}
