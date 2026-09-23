'use client';

/**
 * The client half of the hosted voice.
 *
 * One flag and one fetch. Whether a hosted engine exists is asked once per
 * session and remembered, because the answer is a deployment setting rather
 * than something that changes while somebody is talking; the audio itself is
 * fetched a line at a time, through this app's own route, so the provider's
 * key never reaches the browser.
 *
 * Everything here is a no-op when no key is configured, which is the default.
 */
import { announce } from './appearance';

/** The voice preference that means "use the hosted engine". */
export const HOSTED_PREFIX = 'hosted:';
/** The value threaded through the speech queue in place of a model voice. */
export const HOSTED_VOICE = 'hosted';

let configured: boolean | null = null;
let asking: Promise<boolean> | null = null;

/** Whether the question has been answered yet. */
export const hostedKnown = (): boolean => configured !== null;
export const serverHostedKnown = (): boolean => false;

/** Whether this deployment has a hosted voice. False until asked. */
export const hostedConfigured = (): boolean => configured === true;
export const serverHostedConfigured = (): boolean => false;

/**
 * Asks once, and only once.
 *
 * A failure is an answer too — a deployment that cannot be reached has no
 * hosted voice as far as this conversation is concerned, and retrying on
 * every reply would be a request per sentence for a setting that is not going
 * to change.
 */
export function checkHosted(): Promise<boolean> {
  if (configured !== null) return Promise.resolve(configured);
  if (asking) return asking;
  asking = (async () => {
    try {
      const res = await fetch('/api/companion/voice', { method: 'GET' });
      const data = (await res.json().catch(() => null)) as { configured?: boolean } | null;
      configured = res.ok && data?.configured === true;
    } catch {
      configured = false;
    }
    announce();
    return configured;
  })().finally(() => {
    asking = null;
  });
  return asking;
}

/**
 * Gives up on the hosted engine for the rest of the session.
 *
 * One failed line could be bad luck. The same failure on every line is a
 * setting that is wrong, and the important thing then is that the companion
 * keeps talking: `naturalVoice` reads this, so the next reply is routed to the
 * model in the browser instead. Without it a mistyped voice name in an
 * environment variable made the companion silent, permanently, with nothing on
 * screen to say why.
 */
function unavailable() {
  if (configured === false) return;
  configured = false;
  announce();
}

/**
 * One line, as audio, or null.
 *
 * Null rather than throwing: the caller is a speech queue, and a line it
 * cannot say is a line to skip rather than a reason to stop talking. A 200
 * carrying JSON is the "not configured after all" case, which is treated the
 * same way and remembered so the rest of the reply does not keep asking.
 */
export async function hostedAudio(text: string, speed: number): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch('/api/companion/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, speed }),
    });
    // A 200 carrying JSON is "no key after all"; anything else that is not OK
    // is a configuration or a provider that is not going to start working
    // between one sentence and the next — a voice name the model does not
    // have, a model name the provider does not have, a key that has been
    // revoked, a quota that has run out.
    if (!res.ok || (res.headers.get('content-type') ?? '').includes('json')) {
      unavailable();
      return null;
    }
    const bytes = await res.arrayBuffer();
    if (!bytes.byteLength) {
      unavailable();
      return null;
    }
    return bytes;
  } catch {
    unavailable();
    return null;
  }
}
