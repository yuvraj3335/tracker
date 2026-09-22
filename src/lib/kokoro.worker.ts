/// <reference lib="webworker" />

/**
 * Kokoro, off the main thread.
 *
 * Speech generation is a couple of seconds of solid arithmetic per sentence,
 * and onnxruntime runs it on whichever thread calls it. On the main thread
 * that is two seconds in which the page cannot lay out, cannot paint, and —
 * the part that actually ruins it — cannot start the next piece of audio at
 * the moment the last one ended. So it runs here instead, and the only thing
 * that crosses back is a buffer of samples.
 *
 * One worker holds one model. The pool that decides how many of these to run
 * lives in kokoro.ts; this file knows nothing about the others.
 */
import type { KokoroTTS } from 'kokoro-js';

/** The library types its voice list as a literal union; this is that union. */
type GenerateOptions = NonNullable<Parameters<KokoroTTS['generate']>[1]>;
type VoiceId = NonNullable<GenerateOptions['voice']>;

type LoadMessage = { type: 'load'; dtype: string; device: string; voice: string };
type GenerateMessage = { type: 'generate'; id: number; text: string; voice: string; speed: number };
export type ToWorker = LoadMessage | GenerateMessage;

export type FromWorker =
  | { type: 'progress'; loaded: number; total: number; file: string }
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  | { type: 'audio'; id: number; audio: Float32Array; sampleRate: number; ms: number }
  | { type: 'error'; id: number };

const scope = self as unknown as DedicatedWorkerGlobalScope;

let engine: KokoroTTS | null = null;

const post = (message: FromWorker, transfer?: Transferable[]) =>
  scope.postMessage(message, transfer ?? []);

async function load({ dtype, device, voice }: LoadMessage) {
  try {
    const { KokoroTTS: TTS } = await import('kokoro-js');
    engine = await TTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: dtype as 'q8',
      device: device as 'wasm',
      progress_callback: (report: unknown) => {
        const r = report as { status?: string; file?: string; loaded?: number; total?: number };
        if (r.status !== 'progress' || !r.file || !r.total) return;
        post({ type: 'progress', file: r.file, loaded: r.loaded ?? 0, total: r.total });
      },
    });
    // The first inference builds the graph and is several times slower than
    // every one after it. Spending that here, while the progress figure is
    // still on screen, is the difference between "ready" meaning loaded and
    // "ready" meaning quick.
    await engine.generate('Okay.', { voice: voice as VoiceId });
    post({ type: 'ready' });
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
    // `slice` rather than the model's own view: the buffer is transferred, and
    // transferring a view onto a buffer the runtime still owns would detach
    // memory out from under it.
    const audio = new Float32Array(raw.audio as unknown as Float32Array).slice();
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
