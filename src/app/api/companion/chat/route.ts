import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/tenant';
import { discoverCharacters } from '@/lib/characters.server';
import { resolveCharacter } from '@/lib/characters';
import { createRateLimiter, retryAfterSeconds } from '@/lib/rate-limit';
import { sanitiseHistory, systemPrompt, tidyReply } from '@/lib/companion-prompt';

export const runtime = 'nodejs';
/** A conversation, so it either answers quickly or it has not answered. */
export const maxDuration = 30;

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Chosen by asking the account what it actually has rather than assuming a
 * model name: this key has no Llama models at all, so the usual
 * `llama-3.1-8b-instant` guess would have 404'd on the first real request.
 * gpt-oss-120b answered a in-character prompt in about 150ms of generation,
 * which is the same as the 20b and markedly better, and it is a reasoning
 * model — hence `reasoning_effort: low`, or it spends the whole token budget
 * thinking and returns empty content.
 */
const MODEL = 'openai/gpt-oss-120b';
const MAX_COMPLETION_TOKENS = 320;
const TIMEOUT_MS = 20_000;

/**
 * Twenty messages in five minutes, per user.
 *
 * This guards a billed key against a loop in the client or someone leaning on
 * the endpoint, not against a determined attacker — it is per instance and
 * resets when one recycles. A signed-in session is the real gate; this is the
 * ceiling behind it.
 */
const take = createRateLimiter(20, 5 * 60_000);

/** Everything the client is ever told. No upstream text reaches any of these. */
const COPY = {
  signedOut: 'Sign in to talk to your companion.',
  notConfigured:
    'Your companion is not set up on this deployment yet. Once a Groq key is configured it will be able to talk back.',
  badRequest: 'That message did not come through. Try saying it again.',
  tooMany: 'Give your companion a moment to catch up, then try again.',
  slow: 'Your companion took too long to answer. Try again in a moment.',
  upstream: 'Your companion could not be reached just now. Try again in a moment.',
  empty: 'Your companion did not have anything to say to that. Try asking another way.',
} as const;

type Reply = { ok: true; reply: string } | { ok: false; message: string; configured?: boolean };

const fail = (status: number, message: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json<Reply>({ ok: false, message, ...extra } as Reply, { status });

/**
 * The companion's one endpoint.
 *
 * Signed-in only, exactly like every other route here — this spends a real
 * billed key, so an unauthenticated caller hitting it directly would be
 * spending someone else's money. `currentUser()` is the same check the rest of
 * the app gates on, and it is the first thing that happens.
 *
 * The key is read here and only here. It is never sent to the browser, never
 * prefixed NEXT_PUBLIC_, and when it is absent the route answers with a state
 * rather than an error — the same shape `hasEncryptionKey()` gives the Notion
 * flow, because "not set up" is a thing the product can say, not a fault.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail(401, COPY.signedOut);

  const key = process.env.GROQ_API_KEY?.trim();
  // 200, deliberately: the request worked, the feature is simply not turned on
  // here, and the panel renders that as a state rather than as a failure.
  if (!key) return NextResponse.json<Reply>({ ok: false, message: COPY.notConfigured, configured: false });

  const limit = take(user.id);
  if (!limit.allowed) {
    return NextResponse.json<Reply>(
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
  const messages = sanitiseHistory((body as { messages?: unknown } | null)?.messages);
  if (!messages) return fail(400, COPY.badRequest);

  // The character the model is asked to be is the one this device has chosen,
  // so the companion sounds like the figure on screen rather than a generic
  // assistant. Discovery is a cached filesystem walk, not a fetch.
  const characterId = (body as { characterId?: unknown } | null)?.characterId;
  const character = resolveCharacter(
    discoverCharacters(),
    typeof characterId === 'string' ? characterId : null,
  );

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      signal: abort.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        temperature: 0.85,
        reasoning_effort: 'low',
        messages: [{ role: 'system', content: systemPrompt(character) }, ...messages],
      }),
    });

    if (!res.ok) {
      // Logged where it is useful, never returned. Upstream error text names
      // models, quotas and internal mechanics, and is written for whoever is
      // integrating rather than whoever is talking to a cartoon wizard.
      console.error('[companion] groq responded', res.status, (await res.text()).slice(0, 400));
      return fail(502, res.status === 429 ? COPY.tooMany : COPY.upstream);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const reply = tidyReply(data.choices?.[0]?.message?.content);
    if (!reply) return fail(502, COPY.empty);
    return NextResponse.json<Reply>({ ok: true, reply });
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    if (!aborted) console.error('[companion] request failed:', (e as Error)?.message);
    return fail(504, aborted ? COPY.slow : COPY.upstream);
  } finally {
    clearTimeout(timer);
  }
}
