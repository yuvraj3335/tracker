'use client';

/** Only recording, level measurement and playback happen here. No local AI. */
let playback: AudioContext | null = null;
export async function unlockMisoAudio() {
  playback ??= new AudioContext();
  if (playback.state === 'suspended') await playback.resume();
  return playback;
}

async function responseError(res: Response, fallback: string) {
  const data = await res.json().catch(() => null);
  return new Error(typeof data?.error === 'string' ? data.error : fallback);
}

export function forSpeech(text: string) {
  return text.replace(/```[\s\S]*?```/g, 'The code is shown in the explanation.').replace(/[`*_#]/g, '').replace(/O\(log n\)/g, 'O of log n').replace(/O\(1\)/g, 'constant space or time').trim();
}

export function speechQueue(voice: 'natural' | 'longer', signal: AbortSignal, onStart: () => void) {
  const context = playback;
  let chain = Promise.resolve();
  let failure: Error | null = null;
  let started = false;
  const active = new Set<AudioBufferSourceNode>();
  const stop = () => { for (const source of active) { try { source.stop(); } catch { /* Already ended. */ } } };
  signal.addEventListener('abort', stop, { once: true });
  return {
    push(text: string) {
      text = forSpeech(text);
      if (!text || signal.aborted || failure) return;
      // Prepare the following clip while the preceding one is playing.
      const ready = (async () => {
        if (!context || context.state !== 'running') throw new Error('Tap Talk to enable audio playback.');
        const res = await fetch('/api/companion/voice', { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: text.slice(0, 1200), voice }) });
        if (!res.ok) throw await responseError(res, 'Cloud voice is unavailable.');
        return context.decodeAudioData(await res.arrayBuffer());
      })();
      // Handle rejection immediately, including while an earlier clip plays.
      const handled = ready.then(buffer => ({ buffer, error: null }), error => ({ buffer: null, error: error as Error }));
      chain = chain.then(async () => {
        const { buffer, error } = await handled;
        if (signal.aborted || failure) return;
        if (error || !buffer || !context) { failure = error ?? new Error('No speech was returned.'); return; }
        if (!started) { started = true; onStart(); }
        await new Promise<void>(resolve => {
          const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); active.add(source);
          source.onended = () => { active.delete(source); source.disconnect(); resolve(); };
          if (signal.aborted) { active.delete(source); source.disconnect(); resolve(); return; }
          source.start();
        });
      });
    },
    async end() { try { await chain; if (failure && !signal.aborted) throw failure; } finally { signal.removeEventListener('abort', stop); } },
  };
}

export function speechPieces(buffer: string, final = false): [string[], string] {
  const pieces: string[] = [];
  // Keep a useful phrase together, without forcing canned two-word openers.
  while (buffer.length > 100) {
    const end = buffer.slice(50, 360).search(/[.!?](?:\s|$)/);
    if (end < 0) break;
    const cut = 51 + end;
    pieces.push(buffer.slice(0, cut).trim()); buffer = buffer.slice(cut).trimStart();
  }
  if (final && buffer.trim()) { pieces.push(buffer.trim()); buffer = ''; }
  return [pieces, buffer];
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error('The recording could not be read.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.readAsDataURL(blob);
  });
}

/** Cloud transcription per spoken turn; silent segments are discarded locally. */
export async function openCloudMicrophone(options: {
  signal: AbortSignal;
  onSpeech: () => void;
  onTranscribing: () => void;
  onText: (text: string) => Promise<void>;
  onReady: () => void;
  onError: (error: Error) => void;
}) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record audio. Please use a current browser or type to Miso.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  if (options.signal.aborted) { stream.getTracks().forEach(t => t.stop()); return; }
  let context: AudioContext;
  try { context = await unlockMisoAudio(); } catch (e) { stream.getTracks().forEach(t => t.stop()); throw e; }
  if (options.signal.aborted) { stream.getTracks().forEach(t => t.stop()); return; }
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser(); analyser.fftSize = 1024; source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t));
  let recorder: MediaRecorder | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false, stopped = false;
  let begin = 0, lastLoud = 0, voiced = 0;
  const cleanup = () => {
    if (stopped) return;
    stopped = true; if (timer) clearInterval(timer);
    if (recorder?.state === 'recording') recorder.stop();
    stream.getTracks().forEach(t => t.stop()); source.disconnect(); analyser.disconnect();
    options.signal.removeEventListener('abort', cleanup);
  };
  options.signal.addEventListener('abort', cleanup, { once: true });
  stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
    if (!stopped) { cleanup(); options.onError(new Error('The microphone was disconnected. Tap Talk to reconnect.')); }
  }));
  const start = () => {
    if (stopped || options.signal.aborted) return;
    const chunks: Blob[] = [];
    recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64000 } : undefined);
    begin = Date.now(); lastLoud = 0; voiced = 0; busy = false;
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { cleanup(); options.onError(new Error('Audio recording failed. Tap Talk to retry.')); };
    recorder.onstop = async () => {
      if (stopped || options.signal.aborted) return;
      const hasSpeech = voiced >= 200;
      try {
        if (hasSpeech) {
          options.onTranscribing();
          const blob = new Blob(chunks, { type: mimeType ?? 'audio/webm' });
          if (blob.size > 2800000) throw new Error('That recording is too long. Please use shorter turns.');
          const audio = await base64(blob);
          if (options.signal.aborted) return;
          const res = await fetch('/api/companion/transcribe', { method: 'POST', signal: options.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio }) });
          if (!res.ok) throw await responseError(res, 'Miso could not hear that. Please retry.');
          const data = await res.json();
          const text = typeof data.text === 'string' ? data.text.trim() : '';
          if (text && !options.signal.aborted) await options.onText(text);
        }
        start();
      } catch (e) { if (!options.signal.aborted) { cleanup(); options.onError(e instanceof Error ? e : new Error('The microphone stopped. Please retry.')); } }
    };
    recorder.start(); options.onReady();
  };
  try { start(); } catch (e) { cleanup(); throw e; }
  timer = setInterval(() => {
    if (stopped || busy || recorder?.state !== 'recording') return;
    analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
    const now = Date.now();
    if (rms > 0.018) { lastLoud = now; voiced += 50; if (voiced === 200) options.onSpeech(); }
    const endOfTurn = voiced >= 200 && now - lastLoud > 1200;
    const discardQuiet = voiced < 200 && now - begin > 4000;
    if (endOfTurn || discardQuiet || now - begin > 40000) { busy = true; recorder.stop(); }
  }, 50);
}
