'use client';

/**
 * A voice that does not sound like a computer.
 *
 * The browser's own `speechSynthesis` has one hard ceiling: it can only use
 * the voices the operating system already has, and on most machines the best
 * of those is a formant synthesiser. No amount of ranking or prosody fixes
 * that — it is the wrong engine. Kokoro-82M is a real neural TTS model, it is
 * Apache-licensed, and it is small enough to run in the browser.
 *
 * It runs on the person's own machine rather than on a server, which is the
 * only reason this is free: there is no inference to pay for, no API key to
 * leak, and nothing said out loud ever leaves the device.
 *
 * Three things here are the answer to "why is there a gap before it talks,
 * and why does it stop after every full stop":
 *
 *   1. Generation happens in a worker (`kokoro.worker.ts`), never on the main
 *      thread. It is two seconds of solid arithmetic per sentence, and on the
 *      main thread that is two seconds in which nothing can be painted and —
 *      worse — nothing can start the next piece of audio at the instant the
 *      last one ended.
 *   2. Every generated clip is trimmed. The model pads each one with about a
 *      third of a second of silence at the front and half a second at the
 *      back, which is most of a second of dead air built into every sentence
 *      boundary before any scheduling has even happened.
 *   3. Playback is scheduled on the audio clock rather than chained off
 *      `onended`, so the gap between two sentences is a number chosen in
 *      `pauseAfter` rather than whatever the machine happened to manage.
 *
 * Everything heavy is behind a dynamic import and a worker. Nothing in this
 * file is loaded at all unless a natural voice is actually used.
 */
import { announce } from './appearance';
import { headStartMs, pauseAfter, speedFor } from './speech-shape';
import type { FromWorker, ToWorker } from './kokoro.worker';

/** The voices worth offering, and what they actually sound like. */
export const KOKORO_VOICES = [
  { id: 'af_heart', label: 'Heart — warm, American' },
  { id: 'af_bella', label: 'Bella — bright, American' },
  { id: 'af_nicole', label: 'Nicole — soft, American' },
  { id: 'am_michael', label: 'Michael — steady, American' },
  { id: 'am_puck', label: 'Puck — light, American' },
  { id: 'bf_emma', label: 'Emma — warm, British' },
  { id: 'bf_lily', label: 'Lily — gentle, British' },
  { id: 'bm_george', label: 'George — steady, British' },
  { id: 'bm_fable', label: 'Fable — storytelling, British' },
] as const;

/** How a natural voice is written in the single voice preference. */
export const KOKORO_PREFIX = 'kokoro:';

/**
 * The Kokoro voice a saved preference names, or null if it names a browser
 * voice — or a voice that no longer exists, which is why this validates
 * rather than trusting what came out of localStorage.
 */
export function kokoroVoice(preference: string): string | null {
  if (!preference.startsWith(KOKORO_PREFIX)) return null;
  const id = preference.slice(KOKORO_PREFIX.length);
  return KOKORO_VOICES.some((v) => v.id === id) ? id : null;
}

/** The voice used when nobody has chosen one. Kokoro's best-graded voice. */
export const DEFAULT_VOICE = 'af_heart';

/** What the browser will tell us about the connection and the machine. */
export type DeviceHints = { saveData?: boolean; effectiveType?: string; deviceMemory?: number };

/**
 * Which build of the model to fetch.
 *
 * Measured on a four-core machine, against the same three sentences, warm
 * cache, twice each:
 *
 *   q8    88 MB   1.40x real time   first sentence 3.39 s
 *   fp16 155 MB   1.14x real time   first sentence 2.78 s
 *   q4   291 MB   1.17x real time   (larger than q8: only the matrix
 *                                    multiplies are quantised, the
 *                                    convolutions stay full precision)
 *
 * So the half-precision build is both the fastest and the most faithful, and
 * the trade is purely download size. It is worth 67 MB more on a machine with
 * memory to spare and a connection that is not being counted, and is not
 * worth it on a phone on a train — which is the same judgement
 * `shouldAutoLoad` already makes, so it is made from the same hints.
 */
export type Build = { dtype: 'fp16' | 'q8'; megabytes: number };

export function modelBuild(hints: DeviceHints): Build {
  // A machine that has not said how much memory it has does not get the big
  // build. `deviceMemory` is Chrome-only, so "unknown" is mostly Safari — and
  // mostly, therefore, an iPhone, which is the last place to send 155 MB and
  // then ask it to hold the whole thing in memory. Taking silence for
  // permission is how that decision gets made by accident.
  const roomy = typeof hints.deviceMemory === 'number' && hints.deviceMemory >= 8;
  const metered = hints.saveData || /^(slow-2g|2g|3g)$/.test(hints.effectiveType ?? '');
  return roomy && !metered ? { dtype: 'fp16', megabytes: 155 } : { dtype: 'q8', megabytes: 88 };
}

/**
 * Whether to fetch the model without being asked.
 *
 * A good voice is worth the download on a laptop on wi-fi and is not worth it
 * on a phone on a train, and the browser knows which of those this is. Data
 * Saver is an explicit "no" and is treated as one. Small-memory devices are
 * left out too — not for the download but for what comes after it, since
 * running this on a low-end phone is slower than it is worth.
 *
 * Nothing here blocks *choosing* a natural voice by hand. This decides only
 * what happens when nobody has said anything either way.
 */
export function shouldAutoLoad(hints: DeviceHints): boolean {
  if (hints.saveData) return false;
  if (hints.effectiveType && /^(slow-2g|2g|3g)$/.test(hints.effectiveType)) return false;
  if (typeof hints.deviceMemory === 'number' && hints.deviceMemory < 4) return false;
  return true;
}

export function deviceHints(): DeviceHints {
  if (typeof navigator === 'undefined') return {};
  const n = navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
    deviceMemory?: number;
  };
  return {
    saveData: n.connection?.saveData,
    effectiveType: n.connection?.effectiveType,
    deviceMemory: n.deviceMemory,
  };
}

/** How big the download is, for the one place that says so out loud. */
export const modelMegabytes = (): number => modelBuild(deviceHints()).megabytes;

/** True when a natural voice should be used without anyone having picked one. */
export const autoNatural = (): string | null =>
  shouldAutoLoad(deviceHints()) ? DEFAULT_VOICE : null;

// ------------------------------------------------------------------ loading
export type EngineState = 'off' | 'loading' | 'ready' | 'failed';

let worker: Worker | null = null;
let state: EngineState = 'off';
let loaded = 0;
let loading: Promise<boolean> | null = null;

/** Read through `useSyncExternalStore`, so both of these are plain values. */
export const engineState = (): EngineState => state;
export const serverEngineState = (): EngineState => 'off';
/** 0–100, across every file the model needs. */
export const engineProgress = (): number => loaded;
export const serverEngineProgress = (): number => 0;

function settle(next: EngineState) {
  state = next;
  announce();
}

/** Generations in flight, by the id they were sent with. */
type Pending = { resolve: (clip: Clip | null) => void; chars: number };
const pending = new Map<number, Pending>();
let nextId = 1;

/**
 * The longest one line may take to generate before it is written off.
 *
 * Deliberately generous — this is not a performance budget. It is there
 * because a worker that dies without saying so, which is what a tab under
 * memory pressure does, would otherwise leave behind a promise nothing can
 * ever settle. The speech queue is serial, so exactly one of those makes the
 * companion mute until the page is reloaded.
 */
const CEILING_MS = 8_000;
const CEILING_PER_CHAR_MS = 400;

export type Clip = { audio: Float32Array; sampleRate: number; genMs: number };

/**
 * How long a second of speech costs to generate on this machine, per
 * character of text.
 *
 * Measured rather than assumed, and kept as a running average, because it is
 * the number the head start is computed from and it is different on every
 * machine — a fast laptop generates faster than it speaks and needs no head
 * start at all, while a four-core box needs most of a second.
 */
let msPerChar = 55;

function observe(chars: number, genMs: number) {
  if (chars <= 0) return;
  const sample = genMs / chars;
  // A slow first measurement should not dominate for the rest of the session,
  // and one fast one should not erase what the machine has been doing.
  msPerChar = msPerChar * 0.7 + sample * 0.3;
}

/** Exposed for the bench, and so a test can pin it. */
export const generationCostPerChar = (): number => msPerChar;

function onMessage(event: MessageEvent<FromWorker>) {
  const message = event.data;
  if (message.type === 'audio') {
    // Gone from the map means it was already given up on; the clip is late
    // rather than wanted, and counting its cost would poison the average the
    // head start is computed from.
    const job = pending.get(message.id);
    if (!job) return;
    observe(job.chars, message.ms);
    job.resolve({ audio: message.audio, sampleRate: message.sampleRate, genMs: message.ms });
  } else if (message.type === 'error') {
    pending.get(message.id)?.resolve(null);
  }
}

/**
 * Downloads and warms the model, once.
 *
 * Concurrent callers share one load rather than starting two downloads, and a
 * failure is remembered: a machine that cannot run this is not going to start
 * being able to halfway through a conversation, and retrying on every reply
 * would be a download loop.
 *
 * "Ready" deliberately means ready to be quick, not merely loaded — the
 * worker spends the slow first inference before it answers, while the
 * progress figure is still on screen and the browser's own voice is still
 * covering.
 */
export function loadEngine(voice: string): Promise<boolean> {
  if (state === 'ready') return Promise.resolve(true);
  if (state === 'failed') return Promise.resolve(false);
  if (loading) return loading;
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    return Promise.resolve(false);
  }

  settle('loading');

  loading = new Promise<boolean>((resolve) => {
    // Per file, because transformers.js reports each one separately and a bar
    // that restarts at zero four times is worse than no bar.
    const files = new Map<string, { at: number; of: number }>();
    let spawned: Worker;
    try {
      spawned = new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      settle('failed');
      resolve(false);
      return;
    }

    spawned.addEventListener('message', (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      if (message.type === 'progress') {
        files.set(message.file, { at: message.loaded, of: message.total });
        let at = 0;
        let of = 0;
        for (const f of files.values()) {
          at += f.at;
          of += f.of;
        }
        const next = of ? Math.min(99, Math.round((at / of) * 100)) : 0;
        // Only on a real change, or this announces on every network packet.
        if (next !== loaded) {
          loaded = next;
          announce();
        }
        return;
      }
      if (message.type === 'ready') {
        worker = spawned;
        loaded = 100;
        settle('ready');
        resolve(true);
        return;
      }
      if (message.type === 'failed') {
        spawned.terminate();
        settle('failed');
        resolve(false);
        return;
      }
      onMessage(event);
    });

    spawned.addEventListener('error', () => {
      if (state !== 'ready') {
        settle('failed');
        resolve(false);
        return;
      }
      // It died mid-session — out of memory, usually. Everything waiting on
      // it has to be told: `render` awaits a promise only the worker can
      // settle, and an unsettled one holds the speech queue open for the rest
      // of the session. Answering null makes the caller skip that line, and
      // dropping back to `failed` puts the next reply on the browser's own
      // voice rather than on a worker that is not there.
      worker = null;
      settle('failed');
      const stranded = [...pending.values()];
      pending.clear();
      for (const job of stranded) job.resolve(null);
    });

    const build = modelBuild(deviceHints());
    const message: ToWorker = { type: 'load', dtype: build.dtype, device: 'wasm', voice };
    spawned.postMessage(message);
  }).finally(() => {
    loading = null;
  });

  return loading;
}

function generate(text: string, voice: string, speed: number): Promise<Clip | null> {
  if (!worker) return Promise.resolve(null);
  const id = nextId++;
  const message: ToWorker = { type: 'generate', id, text, voice, speed };
  return new Promise<Clip | null>((resolve) => {
    let done = false;
    const settle = (clip: Clip | null) => {
      if (done) return;
      done = true;
      clearTimeout(ceiling);
      pending.delete(id);
      resolve(clip);
    };
    // Declared after `settle` and closed over by it, so it cannot fire before
    // the statement that creates it has finished running.
    const ceiling = setTimeout(
      () => settle(null),
      CEILING_MS + text.length * CEILING_PER_CHAR_MS,
    );
    pending.set(id, { resolve: settle, chars: text.length });
    worker?.postMessage(message);
  });
}

// ------------------------------------------------------------------ playback
let context: AudioContext | null = null;
let out: GainNode | null = null;
let meter: AnalyserNode | null = null;
let meterData: Float32Array<ArrayBuffer> | null = null;

/**
 * Opens the audio context from inside a tap, so it is allowed to make sound.
 *
 * An `AudioContext` created outside a user gesture starts suspended on mobile
 * Safari and stays that way, which is silence with no error to explain it.
 */
export function primeKokoroAudio() {
  audio();
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) {
    context = new Ctor();
    out = context.createGain();
    meter = context.createAnalyser();
    // Short window: this drives a figure that should react to syllables, not
    // to the average loudness of a sentence.
    meter.fftSize = 512;
    meter.smoothingTimeConstant = 0.6;
    meterData = new Float32Array(meter.fftSize);
    out.connect(meter);
    meter.connect(context.destination);
  }
  // Opening the panel is a click, so there is always a gesture behind this;
  // a context can still be suspended after a tab has been in the background.
  if (context.state === 'suspended') void context.resume();
  return context;
}

/**
 * How loud the voice is right now, 0 to 1.
 *
 * The figure is driven from this rather than from a timer, which is the
 * difference between a mouth that moves while there is a voice and a mouth
 * that moves in time with nothing.
 */
export function speechLevel(): number {
  if (!meter || !meterData) return 0;
  meter.getFloatTimeDomainData(meterData);
  let sum = 0;
  for (let i = 0; i < meterData.length; i++) sum += meterData[i] * meterData[i];
  const rms = Math.sqrt(sum / meterData.length);
  // Speech sits well below full scale, so it needs lifting — but not so far
  // that every vowel pins at the top, which is a figure holding one pose with
  // extra steps. Measured against this model's own output, a loud vowel is
  // around 0.25 RMS, so that is where the top of the range is put.
  return Math.min(1, rms * 4);
}

/** Every source currently scheduled, so stopping means stopping. */
const live = new Set<AudioBufferSourceNode>();

/** A short ramp at each cut, or the trim itself becomes an audible click. */
const FADE_SECONDS = 0.008;

function toBuffer(ctx: AudioContext, clip: Clip): AudioBuffer | null {
  const [from, to] = trimBounds(clip.audio, clip.sampleRate);
  const length = to - from;
  if (length <= 0) return null;
  const buffer = ctx.createBuffer(1, length, clip.sampleRate);
  const channel = buffer.getChannelData(0);
  channel.set(clip.audio.subarray(from, to));
  const fade = Math.min(Math.floor(FADE_SECONDS * clip.sampleRate), Math.floor(length / 2));
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    channel[i] *= g;
    channel[length - 1 - i] *= g;
  }
  return buffer;
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

// ------------------------------------------------------------------ speaking
type Piece = { text: string; index: number };

type Say = {
  voice: string;
  pieces: Piece[];
  closed: boolean;
  cancelled: boolean;
  /** Woken when a piece is pushed or the stream is closed. */
  wake: (() => void) | null;
  onDone?: () => void;
  /** Characters pushed but not yet generated. Drives the head start. */
  waitingChars: number;
};

let queue: Say[] = [];
let draining = false;

/**
 * Lines already generated, so they can be said without the wait.
 *
 * There are only a handful of them — the greeting the panel opens with, and
 * the character's own idle lines — they never change, and they are short. So
 * they are generated once, while the model has nothing else to do, and the
 * second conversation of a session opens instantly instead of pausing on
 * hello.
 */
const warmed = new Map<string, Clip>();
const WARM_LIMIT = 24;
const key = (voice: string, text: string, speed: number) => `${voice}|${speed}|${text}`;

async function render(voice: string, text: string, speed: number): Promise<Clip | null> {
  const cached = warmed.get(key(voice, text, speed));
  if (cached) return cached;
  return generate(text, voice, speed);
}

/**
 * Generates a few lines ahead of time and keeps them.
 *
 * Called with the lines the panel is most likely to open with once the model
 * is ready, which is while the browser's voice is still covering the first
 * conversation — the one moment when there is nothing else for it to be doing.
 */
export async function warm(lines: readonly string[], voice: string) {
  if (state !== 'ready') return;
  for (const line of lines) {
    // Real speech always wins. There is one model and one worker behind it, so
    // a warm-up still running when a reply arrives is a reply waiting behind
    // it — which is the exact wait this was supposed to remove.
    if (queue.length || warmed.size >= WARM_LIMIT) return;
    const speed = speedFor(line, 0);
    if (warmed.has(key(voice, line, speed))) continue;
    const clip = await render(voice, line, speed);
    if (clip) warmed.set(key(voice, line, speed), clip);
  }
}

/**
 * Says one thing, piece by piece, generating ahead of the playback.
 *
 * Every clip is placed on the audio clock the moment it exists, at a time
 * computed from where the previous one ended plus the pause its punctuation
 * asks for. Nothing waits for an `onended` to fire before starting the next
 * piece — that chain is what turns a two-hundred-millisecond breath into
 * whatever the machine was busy with.
 *
 * When generation cannot keep up the schedule slips, and it slips visibly
 * rather than silently: the piece starts as soon as it can and the cursor is
 * reset from there, which is one honest gap instead of a drift that
 * accumulates for the rest of the reply.
 */
async function run(say: Say): Promise<void> {
  const ctx = audio();
  if (!ctx) return;

  let cursor = 0;
  let started = false;
  let last: AudioBufferSourceNode | null = null;
  let taken = 0;

  for (;;) {
    if (say.cancelled) break;
    if (taken >= say.pieces.length) {
      if (say.closed) break;
      await new Promise<void>((resolve) => {
        say.wake = resolve;
      });
      continue;
    }

    const piece = say.pieces[taken++];
    say.waitingChars = Math.max(0, say.waitingChars - piece.text.length);
    const speed = speedFor(piece.text, piece.index);
    const clip = await render(say.voice, piece.text, speed);
    if (say.cancelled) break;
    if (!clip) continue;

    const buffer = toBuffer(ctx, clip);
    if (!buffer) continue;

    const now = ctx.currentTime;
    let at: number;
    if (!started) {
      started = true;
      // Everything still to be generated, priced at what this machine has
      // been managing, against what we already hold. See `headStartMs`.
      const lead = headStartMs(buffer.duration * 1000, say.waitingChars * msPerChar);
      at = now + 0.06 + lead / 1000;
    } else {
      at = Math.max(cursor, now + 0.02);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(out ?? ctx.destination);
    source.onended = () => live.delete(source);
    live.add(source);
    source.start(at);
    last = source;
    cursor = at + buffer.duration + pauseAfter(piece.text) / 1000;
  }

  if (say.cancelled || !last) return;
  // The turn is handed on when the last thing said has actually finished
  // being said, not when the last thing was handed to the audio clock.
  //
  // The clock is the authority and the event is the optimisation, not the
  // other way round. Waiting on `ended` alone is a deadlock waiting to
  // happen: the loop above can sit waiting for more text for longer than the
  // clip takes to play, and a listener attached to a source that has already
  // finished never fires at all — which would leave this job at the head of a
  // serial queue for ever, and every reply after it silent.
  const source = last;
  const endsAt = cursor;
  await new Promise<void>((resolve) => {
    // It can already be over: the loop above sits waiting for more text, and
    // on a slow machine generating the next line outlasts playing the last
    // one. `ended` is a one-shot event, so attaching to it now would wait for
    // ever. `live` is emptied by the same handler that fires it.
    if (!live.has(source)) {
      resolve();
      return;
    }
    let done = false;
    const settle = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    // Declared after `settle` and closed over by it: the timer cannot fire
    // before the statement that creates it has finished running.
    const timer = setTimeout(settle, Math.max(0, (endsAt - ctx.currentTime) * 1000) + 80);
    source.addEventListener('ended', settle, { once: true });
  });
}

async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const say = queue[0];
    await run(say);
    // By identity, never by position. `cancelAll` replaces the array outright,
    // so anything pushed while this job was still generating is now at index
    // zero — and shifting would throw away a job that has never run and whose
    // turn has never been handed back. Closing the panel mid-reply and opening
    // it again was enough to do it.
    const at = queue.indexOf(say);
    if (at >= 0) queue.splice(at, 1);
    if (!say.cancelled) say.onDone?.();
  }
  draining = false;
}

export type KokoroStream = {
  /** One more thing to say, once it has finished arriving. */
  push(line: string): void;
  /** No more is coming. The turn is handed on once the rest has been said. */
  end(): void;
};

/**
 * Opens one continuous utterance that can still be written to.
 *
 * This is what makes a streamed reply sound like one reply. Each sentence used
 * to be its own job with its own playback chain, so the gap between two of
 * them was two independent schedules meeting by luck. Here they are pieces of
 * a single scheduled timeline, and the only silence between them is the one
 * `pauseAfter` asked for.
 */
export function openKokoroStream(
  voice: string,
  onDone?: () => void,
  queued = false,
): KokoroStream {
  if (state !== 'ready') {
    onDone?.();
    return { push: () => {}, end: () => {} };
  }
  if (!queued) cancelAll(false);

  const say: Say = {
    voice,
    pieces: [],
    closed: false,
    cancelled: false,
    wake: null,
    onDone,
    waitingChars: 0,
  };
  queue.push(say);
  void drain();

  const poke = () => {
    const wake = say.wake;
    say.wake = null;
    wake?.();
  };

  return {
    push(line: string) {
      const text = line.trim();
      if (!text || say.closed || say.cancelled) return;
      say.pieces.push({ text, index: say.pieces.length });
      say.waitingChars += text.length;
      poke();
    },
    end() {
      if (say.closed) return;
      say.closed = true;
      poke();
    },
  };
}

/**
 * Reads one finished thing aloud in the chosen natural voice.
 *
 * The greeting and the voice preview go through here; a streamed reply goes
 * through `openKokoroStream` instead, because it does not exist yet when it
 * starts being said.
 */
export function speakKokoro(
  text: string,
  voice: string,
  split: (text: string) => string[],
  onDone?: () => void,
  queued = false,
) {
  if (state !== 'ready' || !text) {
    onDone?.();
    return;
  }
  const stream = openKokoroStream(voice, onDone, queued);
  for (const line of split(text)) stream.push(line);
  stream.end();
}

/**
 * Drops everything queued and silences everything scheduled.
 *
 * `notify` is the difference between being stopped and being superseded, and
 * it matters because the conversation hands the turn on from `onDone`. Being
 * muted mid-reply is a stop: nothing more will be said, so the turn has to
 * come back or the microphone never reopens and the panel sits in `speaking`
 * for ever. Being replaced by a new utterance is not: the thing that replaced
 * it will hand the turn on when it finishes, and two of them doing it would
 * open the microphone underneath a live voice.
 */
function cancelAll(notify: boolean) {
  const dropped = queue;
  queue = [];
  for (const say of dropped) {
    say.cancelled = true;
    const wake = say.wake;
    say.wake = null;
    wake?.();
  }
  for (const source of live) {
    try {
      source.stop();
    } catch {
      /* already ended */
    }
  }
  live.clear();
  // `onDone` is `speakStream`'s own `finish`, which is idempotent, so a job
  // that had already completed cannot hand the same turn on twice.
  if (notify) for (const say of dropped) say.onDone?.();
}

/** Cuts off whatever is being said, including everything still queued. */
export function stopKokoro() {
  cancelAll(true);
}

/** True only when something can actually be said right now. */
export const kokoroReady = (): boolean => state === 'ready';
