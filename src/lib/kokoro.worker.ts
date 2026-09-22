/// <reference lib="webworker" />

/**
 * Kokoro, off the main thread.
 *
 * Speech generation is a couple of seconds of solid arithmetic per sentence,
 * and onnxruntime runs it on whichever thread calls it. On the main thread
 * that is two seconds in which the page cannot lay out, cannot paint, and —
 * the part that actually ruins it — cannot start the next piece of audio at
 * the instant the last one ended. So it runs here instead, and the only thing
 * that crosses back is a buffer of samples.
 *
 * This is also where the machine is asked what it can do. The GPU is tried
 * first where one qualifies, the result is *measured* rather than assumed,
 * and anything that fails to beat the ceiling is torn down and replaced with
 * the WASM build. Nothing here has been run on a discrete GPU, so the
 * measurement is not a nicety — it is the reason the branch is safe to ship.
 *
 * One worker holds one model. The pool that decides how many of these to run
 * lives in kokoro.ts; this file knows nothing about the others.
 */
import type { KokoroTTS } from 'kokoro-js';
import { adapterHints, shouldUseGPU } from './gpu';

/** The library types its voice list as a literal union; this is that union. */
type GenerateOptions = NonNullable<Parameters<KokoroTTS['generate']>[1]>;
type VoiceId = NonNullable<GenerateOptions['voice']>;

type LoadMessage = { type: 'load'; dtype: string; voice: string };
type GenerateMessage = { type: 'generate'; id: number; text: string; voice: string; speed: number };
export type ToWorker = LoadMessage | GenerateMessage;

export type Device = 'webgpu' | 'wasm';

export type FromWorker =
  | { type: 'progress'; loaded: number; total: number; file: string }
  | { type: 'ready'; device: Device; rtf: number }
  | { type: 'failed'; message: string }
  | { type: 'audio'; id: number; audio: Float32Array; sampleRate: number; ms: number }
  | { type: 'error'; id: number };

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/**
 * A sentence of the length the companion actually says, used to time the
 * engine once before trusting it.
 */
const YARDSTICK = 'Okay, that is a lot to be carrying around all day.';

/**
 * How much slower than real time the GPU is allowed to be and still be kept.
 *
 * The WASM build measures about 1.15 on a four-core laptop, so anything above
 * this is not an improvement worth the branch. It is a safety net rather than
 * a coin flip: a real GPU that cannot clear it is strange enough that the
 * known quantity is the better answer.
 */
const GPU_CEILING = 1.5;

const scope = self as unknown as DedicatedWorkerGlobalScope;

let engine: KokoroTTS | null = null;

const post = (message: FromWorker, transfer?: Transferable[]) =>
  scope.postMessage(message, transfer ?? []);

type Loaded = { tts: KokoroTTS; rtf: number };

/**
 * Loads the model on one device and reports how fast it actually is.
 *
 * Two generations, and only the second is timed. The first compiles shaders
 * (on a GPU) or builds the graph (on WASM) and is several times slower than
 * every one after it, so timing that would condemn a device for the cost of
 * starting it.
 */
async function bring(dtype: string, device: Device, voice: VoiceId): Promise<Loaded> {
  const { KokoroTTS: TTS } = await import('kokoro-js');
  const tts = await TTS.from_pretrained(MODEL, {
    dtype: dtype as 'fp16',
    device,
    progress_callback: (report: unknown) => {
      const r = report as { status?: string; file?: string; loaded?: number; total?: number };
      if (r.status !== 'progress' || !r.file || !r.total) return;
      post({ type: 'progress', file: r.file, loaded: r.loaded ?? 0, total: r.total });
    },
  });
  await tts.generate('Okay.', { voice });
  const started = performance.now();
  const raw = await tts.generate(YARDSTICK, { voice });
  const spokenMs = (raw.audio.length / raw.sampling_rate) * 1000;
  return { tts, rtf: (performance.now() - started) / spokenMs };
}

function discard(tts: KokoroTTS) {
  try {
    (tts.model as unknown as { dispose?: () => void })?.dispose?.();
  } catch {
    /* nothing to release, or the runtime does not offer it */
  }
}

async function load({ dtype, voice }: LoadMessage) {
  const id = voice as VoiceId;
  try {
    // Only ever from the half-precision build, which is the same file the
    // WASM path would have downloaded anyway. A device small enough to have
    // been given the quantised build is not one to spend 67 MB more on for a
    // GPU branch that has never been run on its hardware.
    if (dtype === 'fp16' && shouldUseGPU(await adapterHints())) {
      try {
        const gpu = await bring('fp16', 'webgpu', id);
        if (gpu.rtf <= GPU_CEILING) {
          engine = gpu.tts;
          post({ type: 'ready', device: 'webgpu', rtf: gpu.rtf });
          return;
        }
        // It works and it is not worth it. The file is already cached, so
        // starting again on WASM costs a session, not a download.
        discard(gpu.tts);
      } catch {
        /* no GPU path here after all; the WASM build is right below */
      }
    }

    const cpu = await bring(dtype, 'wasm', id);
    engine = cpu.tts;
    post({ type: 'ready', device: 'wasm', rtf: cpu.rtf });
  } catch (e) {
    engine = null;
    post({ type: 'failed', message: e instanceof Error ? e.message : 'unknown' });
  }
}

async function generate({ id, text, voice, speed }: GenerateMessage) {
  if (!engine) {
    post({ type: 'error', id });
    return;
  }
  try {
    const started = performance.now();
    const raw = await engine.generate(text, { voice: voice as VoiceId, speed });
    // A copy that owns its own buffer, so transferring it cannot detach
    // memory the runtime still holds.
    const audio = new Float32Array(raw.audio as unknown as Float32Array);
    post(
      { type: 'audio', id, audio, sampleRate: raw.sampling_rate, ms: performance.now() - started },
      [audio.buffer],
    );
  } catch {
    post({ type: 'error', id });
  }
}

scope.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === 'load') void load(message);
  else if (message.type === 'generate') void generate(message);
});
