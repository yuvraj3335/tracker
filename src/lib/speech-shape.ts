/**
 * How speech is shaped, as opposed to how it is made.
 *
 * Tempo, the length of the pause after a line, where to cut the first thing
 * said so it arrives sooner, and how long to hold playback back so the rest
 * can keep up. All pure, all deterministic, all testable without a browser.
 *
 * Its own file rather than part of speech.ts for one reason: kokoro.ts needs
 * every one of these, and speech.ts imports kokoro.ts. Shared vocabulary at
 * the bottom of the stack, with nothing underneath it.
 */

/**
 * How quickly to say a line in the neural voice.
 *
 * Kokoro has no pitch control — the voice is the voice — so tempo is the only
 * prosody lever it offers, and it is a real one: the model re-predicts every
 * phoneme's duration rather than resampling, so a faster line is genuinely
 * spoken faster rather than played faster.
 *
 * The baseline sits above 1 on purpose. At exactly 1 the model reads, evenly
 * and a little carefully, the way a voice sounds when it is narrating; people
 * talking to each other are quicker than that. The rest mirrors `prosody`: a
 * question settles, an exclamation quickens, a long sentence eases off, and a
 * four-step drift stops consecutive lines being metronomic.
 */
export const BASE_SPEED = 1.06;

export function speedFor(sentence: string, index: number): number {
  const drift = [0, 0.03, -0.02, 0.012][index % 4];
  let speed = BASE_SPEED + drift;
  if (/\?["')\]]*\s*$/.test(sentence)) speed -= 0.035;
  if (/!["')\]]*\s*$/.test(sentence)) speed += 0.04;
  if (sentence.length > 90) speed -= 0.02;
  return Math.min(1.18, Math.max(0.92, Math.round(speed * 1000) / 1000));
}

/**
 * The pause after a line, in milliseconds, read off how the line ends.
 *
 * This is the whole of problem two. Nothing decided how long a gap between
 * two sentences should be: the silence was whatever fell out of the model's
 * own padding plus however long the next line took to generate, which is a
 * buffer, not a breath. So the pauses are chosen here instead — a comma is a
 * beat, a full stop is a breath, a question mark leaves a little room for an
 * answer — and the audio is trimmed and scheduled to hit them exactly.
 *
 * The numbers are the ones conversational speech actually uses: clause breaks
 * around a tenth of a second, sentence breaks around a fifth, a trailing-off
 * ellipsis longer because that is what it means.
 */
export function pauseAfter(line: string): number {
  const end = line.trimEnd();
  if (/(\.\.\.|\u2026)["')\]]*$/.test(end)) return 330;
  if (/\?["')\]]*$/.test(end)) return 270;
  if (/!["')\]]*$/.test(end)) return 230;
  if (/\.["')\]]*$/.test(end)) return 210;
  if (/[,;:]["')\]]*$/.test(end)) return 90;
  // Mid-clause, because the sentence was cut for length rather than punctuated.
  return 60;
}

/**
 * Where to cut the very first thing said, so it arrives sooner.
 *
 * Generating speech costs time in proportion to how much speech it is, and
 * the wait before anything is heard is the cost of the FIRST line alone. A
 * reply that opens "Oof, both at once is horrible." need not be silent for
 * all of it — "Oof," is already something to say, and the rest can be
 * generated while it is being said.
 *
 * Bounded at both ends. Under `LEAD_MIN` a fragment is too short to carry any
 * intonation and lands as a clipped bark; over `LEAD_MAX` there is nothing
 * left to gain, because the sentence is short enough already. Returns null
 * when neither applies, and the caller falls back to whole sentences.
 */
export const LEAD_MIN = 14;
export const LEAD_MAX = 48;

export function leadCut(buffer: string): [string, string] | null {
  // Only worth doing when the sentence is long enough that saying half of it
  // early actually saves anything.
  for (let i = 0; i < buffer.length; i++) {
    const c = buffer[i];
    if (c !== ',' && c !== ';' && c !== ':') continue;
    const lead = buffer.slice(0, i + 1).trim();
    if (lead.length < LEAD_MIN) continue;
    if (lead.length > LEAD_MAX) return null;
    const rest = buffer.slice(i + 1);
    // Only when there is demonstrably more to come, or this is not a cut —
    // it is just the sentence, with a comma on the end.
    if (!rest.trim()) return null;
    return [lead, rest];
  }
  return null;
}

/**
 * How long to hold the first line back so the rest can keep up with it.
 *
 * The model generates speech more slowly than the speech is spoken — measured
 * on a four-core machine, about 1.15 seconds of work per second of voice, and
 * more than that once the silence it pads every clip with is trimmed off. That
 * deficit has to come out somewhere. Left alone it comes out as a stall after
 * the first full stop, which is the thing that sounds broken; spent up front
 * it is a fraction of a second more before it starts talking, and then it
 * talks without stopping.
 *
 * The cap is not a ceiling on the delay, it is a test of whether the trade is
 * worth making at all. If the deficit is larger than `cap`, paying part of it
 * buys nothing — the stall still happens, it just happens later and after a
 * longer silence at the front. So in that case it pays none of it and starts
 * talking as soon as it can, which is the complaint that matters most.
 */
export function headStartMs(bufferedMs: number, generationLeftMs: number, cap = 900): number {
  if (!Number.isFinite(bufferedMs) || !Number.isFinite(generationLeftMs)) return 0;
  const deficit = Math.round(generationLeftMs - bufferedMs);
  if (deficit <= 0 || deficit > cap) return 0;
  return deficit;
}

/**
 * Where the speech actually starts and stops inside a generated clip.
 *
 * Kokoro pads every clip: measured across sentences of every length it is
 * about 320 ms of silence at the front and 500 ms at the back, near enough
 * regardless of what was said. Played as-is that is eight hundred
 * milliseconds of nothing at every sentence boundary — before any of the
 * waiting-for-the-next-one silence is added to it — and it is the single
 * largest part of "it stops for ages after every full stop".
 *
 * Pure, and on a plain array, so the thresholds can be tested without an
 * audio context. A guard band is kept at each end rather than cutting hard
 * against the first loud sample, because a stop consonant starts quietly and
 * clipping its onset is how a trimmed voice starts sounding chewed.
 */
export const SILENCE_FLOOR = 0.02;
export const GUARD_MS = 30;

export function trimBounds(
  audio: ArrayLike<number>,
  sampleRate: number,
  floor = SILENCE_FLOOR,
): [number, number] {
  const window = Math.max(1, Math.round(sampleRate * 0.01));
  const guard = Math.round((GUARD_MS / 1000) * sampleRate);
  let first = -1;
  let last = -1;
  for (let i = 0; i + window <= audio.length; i += window) {
    let peak = 0;
    for (let j = i; j < i + window; j++) {
      const v = audio[j] < 0 ? -audio[j] : audio[j];
      if (v > peak) peak = v;
    }
    if (peak > floor) {
      if (first < 0) first = i;
      last = i + window;
    }
  }
  // Nothing above the floor anywhere: it is silence, and saying so is better
  // than handing back a zero-length buffer the caller has to special-case.
  if (first < 0) return [0, 0];
  return [Math.max(0, first - guard), Math.min(audio.length, last + guard)];
}
