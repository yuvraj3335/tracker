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
 * leak, and nothing said out loud ever leaves the device. The cost is a
 * one-time model download, which is why it is opted into by name in the voice
 * picker rather than started behind someone's back on a phone.
 *
 * Everything heavy is behind a dynamic import. Nothing in this file is loaded
 * at all unless a natural voice is actually chosen.
 */
import { announce } from './appearance';

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

export type Backend = { device: 'webgpu' | 'wasm'; dtype: 'fp32' | 'q8'; megabytes: number };

/**
 * Which build of the model to fetch.
 *
 * A machine with WebGPU can run the full-precision model faster than real
 * time, and is by definition a machine that can afford the download. Anything
 * else gets the quantised build, which is a third of the size and the only
 * thing that is bearable on a CPU.
 */
export function pickBackend(hasWebGPU: boolean): Backend {
  return hasWebGPU
    ? { device: 'webgpu', dtype: 'fp32', megabytes: 330 }
    : { device: 'wasm', dtype: 'q8', megabytes: 90 };
}

/**
 * Whether WebGPU is real here, which is not the same question as whether
 * `navigator.gpu` exists.
 *
 * It exists in plenty of places that have no adapter behind it — headless
 * browsers, VMs, machines with the GPU blocklisted — and the only way to know
 * is to ask for one. Getting this wrong would quote a 330 MB download and
 * then fail to run the thing it downloaded.
 */
let adapter: boolean | null = null;

export async function probeGPU(): Promise<boolean> {
  if (adapter !== null) return adapter;
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    adapter = gpu ? (await gpu.requestAdapter()) !== null : false;
  } catch {
    adapter = false;
  }
  announce();
  return adapter;
}

/** Assumes the modest build until the probe says otherwise. */
export function backend(): Backend {
  return pickBackend(adapter === true);
}

// ------------------------------------------------------------------ loading
export type EngineState = 'off' | 'loading' | 'ready' | 'failed';

type Raw = { audio: Float32Array; sampling_rate: number };

type Engine = {
  generate(text: string, options: { voice: string }): Promise<Raw>;
};

let engine: Engine | null = null;
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

/**
 * Downloads and warms the model, once.
 *
 * Concurrent callers share one load rather than starting two downloads, and a
 * failure is remembered: a machine that cannot run this is not going to start
 * being able to halfway through a conversation, and retrying on every reply
 * would be a download loop.
 *
 * "Ready" deliberately means ready to be quick, not merely loaded. The very
 * first inference is several times slower than every one after it — the
 * runtime is still building its graph — and that cost has to land here, while
 * the progress figure is on screen and the browser's own voice is still
 * answering, rather than on the first thing anybody actually asks.
 */
export function loadEngine(voice: string): Promise<boolean> {
  if (state === 'ready') return Promise.resolve(true);
  if (state === 'failed') return Promise.resolve(false);
  if (loading) return loading;

  settle('loading');

  // Per file, because transformers.js reports each one separately and a bar
  // that restarts at zero four times is worse than no bar.
  const files = new Map<string, { at: number; of: number }>();

  loading = (async () => {
    try {
      // Asked before the model id is chosen, because the answer picks it.
      await probeGPU();
      const { device, dtype } = backend();
      const { KokoroTTS } = await import('kokoro-js');
      const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype,
        device,
        progress_callback: (report: { status?: string; file?: string; loaded?: number; total?: number }) => {
          if (report.status !== 'progress' || !report.file || !report.total) return;
          files.set(report.file, { at: report.loaded ?? 0, of: report.total });
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
        },
      });
      engine = tts as unknown as Engine;
      // Discarded on purpose: this is the slow first inference, spent here.
      await engine.generate('Okay.', { voice });
      loaded = 100;
      settle('ready');
      return true;
    } catch {
      engine = null;
      settle('failed');
      return false;
    } finally {
      loading = null;
    }
  })();

  return loading;
}

// ------------------------------------------------------------------ playback
let context: AudioContext | null = null;
let playing: AudioBufferSourceNode | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  // Opening the panel is a click, so there is always a gesture behind this;
  // a context can still be suspended after a tab has been in the background.
  if (context.state === 'suspended') void context.resume();
  return context;
}

function playChunk(raw: { audio: Float32Array; sampling_rate: number }): Promise<void> {
  const ctx = audio();
  if (!ctx) return Promise.resolve();
  const buffer = ctx.createBuffer(1, raw.audio.length, raw.sampling_rate);
  // `set` rather than `copyToChannel`: the model hands back a view on its own
  // buffer, and this copies out of it without caring what kind it is.
  buffer.getChannelData(0).set(raw.audio);
  return new Promise((resolve) => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      if (playing === source) playing = null;
      resolve();
    };
    playing = source;
    source.start();
  });
}

type Job = { text: string; voice: string; onDone?: () => void; cancelled: boolean };

let queue: Job[] = [];
let draining = false;

/**
 * Lines already generated, so they can be said without the wait.
 *
 * Generating a sentence takes a couple of seconds, which is exactly what the
 * filler is there to cover — so a filler that had to be generated first would
 * cover nothing. There are only a handful of them, they never change, and
 * they are short, so they are made once and kept.
 */
const warmed = new Map<string, Raw>();
const WARM_LIMIT = 24;

const key = (voice: string, text: string) => `${voice}|${text}`;

async function render(voice: string, text: string): Promise<Raw | null> {
  const cached = warmed.get(key(voice, text));
  if (cached) return cached;
  if (!engine) return null;
  try {
    return await engine.generate(text, { voice });
  } catch {
    return null;
  }
}

/**
 * Generates a few lines ahead of time and keeps them.
 *
 * Called with the filler lines once the model is ready, which is while the
 * greeting is still being said — the one moment in a conversation when there
 * is nothing else for it to be doing.
 */
export async function warm(lines: readonly string[], voice: string) {
  if (state !== 'ready') return;
  for (const line of lines) {
    if (warmed.size >= WARM_LIMIT) return;
    if (warmed.has(key(voice, line))) continue;
    const raw = await render(voice, line);
    if (raw) warmed.set(key(voice, line), raw);
  }
}

/**
 * Says one thing, sentence by sentence, generating ahead of the playback.
 *
 * The next sentence starts generating as soon as the previous one has been
 * generated rather than when it has finished playing, so after the first one
 * the audio keeps up with itself. Without that a paragraph would be several
 * seconds of silence before a word of it was heard — the difference between a
 * conversation and a download.
 *
 * `generate` per sentence rather than the library's `stream`: on a plain
 * string that generator yields every chunk and then never returns, because
 * nothing ever closes the splitter feeding it. This also puts the sentence
 * boundaries under the same `splitForSpeech` rules the browser voice uses.
 */
async function run(job: Job, sentences: string[]) {
  let tail: Promise<void> = Promise.resolve();
  for (const sentence of sentences) {
    if (job.cancelled) break;
    const raw = await render(job.voice, sentence);
    if (job.cancelled || !raw) break;
    const previous = tail;
    tail = (async () => {
      await previous;
      if (!job.cancelled) await playChunk(raw);
    })();
  }
  await tail;
}

async function drain(split: (text: string) => string[]) {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const job = queue[0];
    await run(job, split(job.text));
    queue.shift();
    if (!job.cancelled) job.onDone?.();
  }
  draining = false;
}

/**
 * Reads something aloud in the chosen natural voice.
 *
 * `queue` is what lets a reply land behind the filler that covered the wait
 * for it rather than cutting it off, and mirrors `speak` in speech.ts. The
 * splitter is passed in rather than imported so this file does not depend on
 * speech.ts, which depends on it.
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
  if (!queued) stopKokoro();
  queue.push({ text, voice, onDone, cancelled: false });
  void drain(split);
}

/** Cuts off whatever is being said, including everything still queued. */
export function stopKokoro() {
  for (const job of queue) job.cancelled = true;
  queue = [];
  try {
    playing?.stop();
  } catch {
    /* already ended */
  }
  playing = null;
}

/** True only when something can actually be said right now. */
export const kokoroReady = (): boolean => state === 'ready';
