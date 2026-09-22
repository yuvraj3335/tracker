'use client';

import { useEffect, useState } from 'react';

/**
 * The bench itself. Everything it can do is also hung on `window.__voicelab`,
 * because the numbers that matter are read by a script driving a real browser
 * rather than by a person squinting at a page.
 */
type Raw = { audio: Float32Array; sampling_rate: number };
type Engine = { generate(text: string, o: { voice: string; speed?: number }): Promise<Raw> };

declare global {
  interface Window {
    __voicelab?: Record<string, unknown>;
  }
}

export function VoiceLab() {
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    const say = (line: string) => setLog((l) => [...l, line]);
    let engine: Engine | null = null;

    const load = async (dtype = 'q8', device = 'wasm', threads?: number) => {
      const { KokoroTTS } = await import('kokoro-js');
      const { env } = await import('@huggingface/transformers');
      const wasm = env.backends.onnx.wasm!;
      if (threads) wasm.numThreads = threads;
      const t0 = performance.now();
      const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: dtype as 'q8',
        device: device as 'wasm',
      });
      engine = tts as unknown as Engine;
      const loadMs = performance.now() - t0;
      const w0 = performance.now();
      await engine.generate('Okay.', { voice: 'af_heart' });
      const warmMs = performance.now() - w0;
      const cfg = {
        numThreads: wasm.numThreads,
        simd: wasm.simd,
        proxy: wasm.proxy,
      };
      say(`load ${dtype}/${device} ${Math.round(loadMs)}ms, first inference ${Math.round(warmMs)}ms, ${JSON.stringify(cfg)}`);
      return { loadMs, warmMs, ...cfg };
    };

    const gen = async (text: string, voice = 'af_heart', speed = 1) => {
      if (!engine) throw new Error('not loaded');
      // How long the main thread was unavailable, not just how long the call
      // took: a frozen page is the actual complaint.
      let blocked = 0;
      let last = performance.now();
      const tick = setInterval(() => {
        const now = performance.now();
        blocked = Math.max(blocked, now - last - 16);
        last = now;
      }, 16);
      const t0 = performance.now();
      const raw = await engine.generate(text, { voice, speed });
      const ms = performance.now() - t0;
      clearInterval(tick);
      const seconds = raw.audio.length / raw.sampling_rate;
      return {
        chars: text.length,
        ms: Math.round(ms),
        audioMs: Math.round(seconds * 1000),
        rtf: +(ms / 1000 / seconds).toFixed(2),
        stallMs: Math.round(blocked),
      };
    };

    /** Spins up `n` independent workers and reports what they manage together. */
    const pool = async (n: number, texts: string[], dtype = 'q8') => {
      const workers = Array.from(
        { length: n },
        () => new Worker(new URL('@/lib/kokoro.worker.ts', import.meta.url), { type: 'module' }),
      );
      const ready = workers.map(
        (w) =>
          new Promise<number>((resolve, reject) => {
            const t0 = performance.now();
            w.addEventListener('message', (e: MessageEvent) => {
              if (e.data.type === 'ready') resolve(performance.now() - t0);
              if (e.data.type === 'failed') reject(new Error(e.data.message));
            });
            w.postMessage({ type: 'load', dtype, device: 'wasm', voice: 'af_heart' });
          }),
      );
      const loadMs = await Promise.all(ready);

      let next = 0;
      const t0 = performance.now();
      const results: { text: string; ms: number; audioMs: number; doneAt: number }[] = [];
      const run = (w: Worker) =>
        new Promise<void>((resolve) => {
          const step = () => {
            const i = next++;
            if (i >= texts.length) return resolve();
            const id = i;
            const onMessage = (e: MessageEvent) => {
              if (e.data.id !== id) return;
              w.removeEventListener('message', onMessage);
              results[id] = {
                text: texts[id].slice(0, 24),
                ms: Math.round(e.data.ms),
                audioMs: Math.round((e.data.audio.length / e.data.sampleRate) * 1000),
                doneAt: Math.round(performance.now() - t0),
              };
              step();
            };
            w.addEventListener('message', onMessage);
            w.postMessage({ type: 'generate', id, text: texts[id], voice: 'af_heart', speed: 1 });
          };
          step();
        });
      await Promise.all(workers.map(run));
      const wallMs = Math.round(performance.now() - t0);
      const audioMs = results.reduce((a, r) => a + r.audioMs, 0);
      workers.forEach((w) => w.terminate());
      return {
        workers: n,
        loadMs: loadMs.map((m) => Math.round(m)),
        wallMs,
        audioMs,
        rtf: +(wallMs / audioMs).toFixed(2),
        results,
      };
    };

    window.__voicelab = { load, gen, pool, get engine() { return engine; } };
    say('ready — window.__voicelab.load() then .gen(text)');
    return () => {
      delete window.__voicelab;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="skin-card border border-hairline bg-surface-2 px-4 py-2.5 text-xs text-ink-2">
        <strong>Voice bench.</strong> Development only. Drive it from{' '}
        <code>window.__voicelab</code>.
      </div>
      <pre className="skin-card overflow-x-auto border border-hairline bg-surface p-4 text-xs text-ink-2">
        {log.join('\n')}
      </pre>
    </div>
  );
}
