import { NextResponse } from 'next/server';
import { currentUser, tenantStatus } from '@/lib/tenant';
import { getEverything } from '@/lib/notion';
import { discoverCharacters } from '@/lib/characters.server';
import { resolveCharacter } from '@/lib/characters';
import { createRateLimiter, retryAfterSeconds } from '@/lib/rate-limit';
import { buildSnapshot } from '@/lib/companion-context';
import { sanitiseHistory, systemPrompt, tidyReply } from '@/lib/companion-prompt';

export const runtime = 'nodejs';
/** A conversation, so it either answers quickly or it has not answered. */
export const maxDuration = 30;

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Claude Haiku 4.5. The id was read off the account's own model list rather
 * than guessed — the last two providers this was built against both turned out
 * not to have the model everyone assumes they do.
 */
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 260;
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
    'Your companion is not set up on this deployment yet. Once a key is configured it will be able to talk back.',
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

  const key = process.env.ANTHROPIC_API_KEY?.trim();
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

  // What it actually knows about them. Derived through derive.ts so the
  // numbers it says out loud are the same ones the dashboard shows, and read
  // here rather than trusted from the client, which could claim anything.
  //
  // Notion being slow or down must never take the conversation with it: a
  // companion that cannot see the tracker is a far smaller loss than one that
  // refuses to talk at all.
  let snapshot: string | null = null;
  try {
    const status = await tenantStatus();
    if (status.kind === 'ready') {
      const { areas, topics, tasks } = await getEverything(status.tenant);
      snapshot = buildSnapshot(areas, topics, tasks);
    }
  } catch (e) {
    console.error('[companion] could not read the tracker:', (e as Error)?.message);
  }

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: abort.signal,
      headers: {
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      // The system prompt is a top-level field here rather than a first
      // message, which is the one thing that differs from every
      // OpenAI-shaped API this has talked to.
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 1,
        system: systemPrompt(character, snapshot),
        messages,
      }),
    });

    if (!res.ok) {
      // Logged where it is useful, never returned. Upstream error text names
      // models, quotas and internal mechanics, and is written for whoever is
      // integrating rather than whoever is talking to a cartoon wizard.
      console.error('[companion] anthropic responded', res.status, (await res.text()).slice(0, 300));
      return fail(502, res.status === 429 ? COPY.tooMany : COPY.upstream);
    }

    const data = (await res.json()) as { content?: { type?: string; text?: unknown }[] };
    const spoken = data.content?.find((block) => block.type === 'text')?.text;
    const reply = tidyReply(spoken);
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
