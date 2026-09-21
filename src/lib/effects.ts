'use client';

/**
 * Optional sound and haptics on a tick. Off by default, and off is the honest
 * default — an app that makes noise the first time you touch it is a bug as far
 * as most people are concerned.
 *
 * The sound is synthesized with WebAudio rather than shipped as a file. Two
 * reasons: no binary asset in the repo, and no download for a feature most
 * people will never switch on. It is a short percussive blip, not a sample.
 *
 * Both are fire-and-forget and both swallow their own failures. Audio is
 * blocked until a user gesture in every browser, `navigator.vibrate` does not
 * exist on desktop Safari, and neither is important enough to surface an error
 * for — the tick itself already worked.
 */
import { getEffects } from './appearance';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    // Created lazily on the first enabled tick, which is guaranteed to be
    // inside a user gesture — constructing it earlier gets it suspended.
    ctx ??= new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * A short blip. `big` is used for the milestone tiers — same shape, higher and
 * a touch longer, so the escalation is audible as well as visual.
 */
export function playTick(big = false) {
  if (!getEffects()) return;
  const ac = audio();
  if (!ac) return;
  try {
    if (ac.state === 'suspended') void ac.resume();
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(big ? 880 : 660, now);
    osc.frequency.exponentialRampToValueAtTime(big ? 1320 : 990, now + 0.06);
    // Quiet, and decaying — this fires after every single tick.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(big ? 0.09 : 0.05, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (big ? 0.22 : 0.13));
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + (big ? 0.24 : 0.15));
  } catch {
    /* never let feedback break the interaction that triggered it */
  }
}

/** A short buzz on phones. Same toggle as sound — one "feedback" preference. */
export function vibrate(big = false) {
  if (!getEffects()) return;
  try {
    navigator.vibrate?.(big ? [12, 40, 18] : 10);
  } catch {
    /* unsupported, or blocked by a permissions policy */
  }
}

/** Both, for a completed question. */
export function feedbackForTick(big = false) {
  playTick(big);
  vibrate(big);
}
