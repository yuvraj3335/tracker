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
 *
 * There is a third engine now, and it is why this file owns playback rather
 * than Kokoro owning it: where a deployment has configured a hosted voice,
 * the clips come over the network instead of out of the worker. Everything
 * after that point — the trimming, the chosen pauses, the audio clock, the
 * level the figure is drawn from — is the same code for all three, because
 * all three have the same problem once the samples exist.
 */
import { announce } from './appearance';
import { headStartMs, pauseAfter, speedFor, trimBounds } from './speech-shape';
import { HOSTED_VOICE, hostedAudio, hostedConfigured } from './hosted-voice';
import type { Device, FromWorker, ToWorker } from './kokoro.worker';

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
 *
 * Re-measured on a different four-core machine, headless Chromium, four
 * sentences each, and it does not agree:
 *
 *   q8    2 threads   2.02x real time
 *   q8    4 threads   2.64x
 *   fp16  2 threads   2.16x
 *   fp16  4 threads   2.57x
 *
 * Two things follow. More threads is worse, not better, so the default of
 * `hardwareConcurrency / 2` is already right and is left alone. And on that
 * machine fp16 is both 67 MB larger AND slower, which is the opposite of the
 * reason it is chosen — but one contradicting machine is not enough to flip a
 * default whose other stated argument is fidelity, which cannot be measured
 * from here. So the choice stands and the disagreement is written down.
 *
 * What the second set of numbers really says is that neither build keeps up
 * with speech on a machine like this. See `WASM_CEILING`.
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

/**
 * How much slower than real time the CPU build may be and still be used
 * without being asked for.
 *
 * The GPU branch has always had this test — anything that cannot beat
 * `GPU_CEILING` is torn down and replaced. The CPU build had none, so whatever
 * it managed was kept, and what it manages is the whole of whether a spoken
 * reply flows or stops dead after every sentence.
 *
 * Where the number comes from. The pauses this file schedules are about 210 ms
 * after a full stop, and `headStartMs` will hold the first line back by up to
 * 900 ms to let the rest catch up. Over a ten-second reply that is roughly
 * 1.5 s of slack, so generation can run about 1.15x real time and still sound
 * continuous — which is exactly the design point the comments elsewhere here
 * quote. 1.4 leaves a margin on top of it rather than sitting on the edge.
 *
 * Measured past it, on the real panel and the real audio clock, with the model
 * running at 2.0x: first sound 4.4 s after the reply was asked for, then
 * "Nice one." for 710 ms, then 4,747 ms of silence, then 1,841 ms of silence.
 * Against a designed 210 ms. That is not a good voice with a flaw, it is the
 * exact failure this file was written to remove, and on that machine the
 * browser's own voice is the better answer.
 *
 * It gates the automatic choice only. Picking a natural voice by hand is still
 * honoured, stalls and all, because it was asked for.
 */
export const WASM_CEILING = 1.4;

/** What this device turned out to manage, remembered between sessions. */
export const SPEED_KEY = 'jst-voice-speed';

/**
 * Whether the model has already been judged too slow here.
 *
 * Remembered, because the judgement costs a download to reach. Finding out
 * once is the price of measuring; finding out again on every visit is just
 * spending someone's data to re-learn something this device already knows.
 */
export function knownTooSlow(): boolean {
  try {
    const seen = Number(localStorage.getItem(SPEED_KEY));
    return Number.isFinite(seen) && seen > WASM_CEILING;
  } catch {
    return false;
  }
}

function rememberSpeed(rtf: number) {
  try {
    localStorage.setItem(SPEED_KEY, String(Math.round(rtf * 100) / 100));
  } catch {
    /* ignore — it still applies for this session */
  }
}

/**
 * How many conversations before the voice downloads itself.
 *
 * Nought meant the very first tap on the character — someone finding out what
 * it does — cost 88 MB of somebody's data before they had heard a word. The
 * browser reports `effectiveType: '4g'` for wi-fi and for mobile data alike,
 * so there is no way to tell a train from a sofa; `saveData` is the only
 * explicit signal and most people never set it.
 *
 * So it waits for the one signal that is unambiguous: coming back. A second
 * conversation on this device is a person who has decided they want this, and
 * the first one still gets a voice — the browser's — exactly as it does today
 * while the model is downloading.
 */
export const CONVERSATIONS_BEFORE_DOWNLOAD = 1;
export const VISITS_KEY = 'jst-voice-visits';

/** Counted once per conversation, by the panel, on the way in. */
export function countConversation(): number {
  try {
    const next = (Number(localStorage.getItem(VISITS_KEY)) || 0) + 1;
    localStorage.setItem(VISITS_KEY, String(next));
    return next;
  } catch {
    // No storage means no memory of a first visit, so nothing is ever a
    // second one and the download never starts unasked. Choosing by hand
    // still works.
    return 0;
  }
}

export function conversations(): number {
  try {
    return Number(localStorage.getItem(VISITS_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** True when a natural voice should be used without anyone having picked one. */
export const autoNatural = (): string | null => {
  if (!shouldAutoLoad(deviceHints())) return null;
  if (knownTooSlow()) return null;
  if (conversations() <= CONVERSATIONS_BEFORE_DOWNLOAD) return null;
  return DEFAULT_VOICE;
};

// ------------------------------------------------------------------ loading
export type EngineState = 'off' | 'loading' | 'ready' | 'failed';

let worker: Worker | null = null;
let state: EngineState = 'off';
let loaded = 0;
let loading: Promise<boolean> | null = null;
let device: Device | null = null;
/** Measured, and past `WASM_CEILING`. See there for what that means. */
let tooSlow = false;

/** Whether this machine turned out to be too slow to use the model unasked. */
export const engineTooSlow = (): boolean => tooSlow || knownTooSlow();
export const serverEngineTooSlow = (): boolean => false;

/**
 * What is making the sound. Three engines, one queue.
 *
 * The hosted one needs nothing loaded, so it is ready the moment the
 * deployment says it exists; the other two are the same model on different
 * hardware, and which one it ended up on is only known after the worker has
 * measured them.
 */
export type EngineKind = 'hosted' | Device | 'none' | 'slow';

export function engineKind(): EngineKind {
  if (hostedConfigured()) return 'hosted';
  // Loaded but not used unasked, so saying "on this machine" would be a lie
  // about what Auto is doing.
  if (engineTooSlow()) return 'slow';
  if (state !== 'ready') return 'none';
  return device ?? 'wasm';
}
export const serverEngineKind = (): EngineKind => 'none';

/** Whether this particular voice can speak right now. */
export const voiceReady = (voice: string): boolean =>
  voice === HOSTED_VOICE ? hostedConfigured() : state === 'ready';

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
  // The hosted engine has nothing to load, and asking the worker to warm up
  // on a voice the model has never heard of would fail the whole load.
  if (voice === HOSTED_VOICE) return Promise.resolve(hostedConfigured());
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
        // Only the CPU build is judged here. The GPU path already measured
        // itself against `GPU_CEILING` in the worker and would have been torn
        // down there if it could not clear it.
        if (message.device === 'wasm') rememberSpeed(message.rtf);
        if (message.device === 'wasm' && message.rtf > WASM_CEILING) {
          // It works, and it cannot keep up with speech. Kept loaded, because
          // a voice chosen by hand is still honoured — `tooSlow` only takes it
          // out of the automatic choice.
          tooSlow = true;
        }
        worker = spawned;
        loaded = 100;
        device = message.device;
        // Measured on this machine, on the device it actually ended up using,
        // so the head start is priced from the truth rather than from an
        // average of every machine this has ever run on. Taken as reported:
        // rebuilding it here from a ratio and two constants describing the
        // worker's own test sentence was three places for the units to drift.
        msPerChar = message.msPerChar;
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
    // Which *build* to fetch is decided here, from what the browser says about
    // the machine. Which *device* runs it is decided in the worker, from what
    // the GPU says about itself and then from how fast it actually turns out
    // to be. See `useWebGPU` and the yardstick in kokoro.worker.ts.
    const message: ToWorker = { type: 'load', dtype: build.dtype, voice };
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
/**
 * Whether anything is actually routed through the meter.
 *
 * `speechLevel` reads an analyser on this file's own audio graph, and the
 * browser's `speechSynthesis` does not go through it — its output is not
 * capturable at all. So on the browser voice the level is a flat zero, and the
 * figure was being driven every frame by a number that could not change.
 *
 * The honest answer is not to fake a level. It is to say there isn't one, and
 * let the caller fall back to something that claims less.
 */
export const hasSpeechLevel = (): boolean => live.size > 0;

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
 * Trimming lives in speech-shape.ts, with the rest of the pure vocabulary, so
 * the worker can import it too — it has to measure itself against the duration
 * that will actually be heard, not the one the model padded.
 */
export { SILENCE_FLOOR, GUARD_MS, trimBounds } from './speech-shape';

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
  /** Fires once, when the first clip actually reaches the speaker. */
  onStart?: () => void;
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

/**
 * One line, as samples, from whichever engine is in use.
 *
 * The hosted one hands back an encoded file rather than a buffer, so it is
 * decoded here — through the same audio context everything else is scheduled
 * on, which is also the only thing in the browser that knows how to read a
 * WAV. Everything downstream of this point is identical for all three
 * engines: the same trimming, the same pauses, the same clock.
 */
async function hosted(text: string, speed: number): Promise<Clip | null> {
  const ctx = audio();
  if (!ctx) return null;
  const started = performance.now();
  const bytes = await hostedAudio(text, speed);
  if (!bytes) return null;
  try {
    const decoded = await ctx.decodeAudioData(bytes);
    const genMs = performance.now() - started;
    observe(text.length, genMs);
    return { audio: decoded.getChannelData(0), sampleRate: decoded.sampleRate, genMs };
  } catch {
    return null;
  }
}

async function render(voice: string, text: string, speed: number): Promise<Clip | null> {
  const cached = warmed.get(key(voice, text, speed));
  if (cached) return cached;
  if (voice !== HOSTED_VOICE) return generate(text, voice, speed);

  const clip = await hosted(text, speed);
  if (clip) return clip;
  // The hosted engine has just taken itself out of service. Nothing can be
  // done for this line — the model in the browser was never loaded, because
  // there was no reason to — but starting it now is what puts the *next*
  // reply back on its feet instead of leaving the companion mute for the rest
  // of the session.
  void loadEngine(DEFAULT_VOICE);
  return null;
}

/**
 * Generates a few lines ahead of time and keeps them.
 *
 * Called with the lines the panel is most likely to open with once the model
 * is ready, which is while the browser's voice is still covering the first
 * conversation — the one moment when there is nothing else for it to be doing.
 */
export async function warm(lines: readonly string[], voice: string) {
  if (!voiceReady(voice)) return;
  for (const [index, line] of lines.entries()) {
    // Real speech always wins. There is one model and one worker behind it, so
    // a warm-up still running when a reply arrives is a reply waiting behind
    // it — which is the exact wait this was supposed to remove.
    if (queue.length || warmed.size >= WARM_LIMIT) return;
    // The same index the queue will hand this line, because `speedFor` drifts
    // with it and the speed is part of the cache key. Warming every line at
    // index 0 cached a speed nothing would ever ask for past the first one.
    const speed = speedFor(line, index);
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
      // A buffer source has no `start` event, so the clock it was scheduled
      // against is the thing to ask. This is what tells the caption a voice
      // has actually begun rather than that bytes have.
      const begins = say.onStart;
      say.onStart = undefined;
      if (begins) setTimeout(begins, Math.max(0, (at - ctx.currentTime) * 1000));
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
  onStart?: () => void,
): KokoroStream {
  if (!voiceReady(voice)) {
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
    onStart,
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
  onStart?: () => void,
) {
  if (!voiceReady(voice) || !text) {
    onDone?.();
    return;
  }
  const stream = openKokoroStream(voice, onDone, queued, onStart);
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
