'use client';

import { cutSentences } from './speech-segments';
import { cloudSpeechQueue } from './miso-playback';

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
  return text.replace(/```[\s\S]*?```/g, 'The code is shown in the explanation.').replace(/[`*_#]/g, '').replace(/O\(log n\)/g, 'O of log n').replace(/O\(1\)/g, 'O of one').trim();
}

export function speechQueue(voice: 'natural' | 'longer', signal: AbortSignal, onStart: () => void) {
  const queue = cloudSpeechQueue(playback, voice, signal, onStart);
  return { ...queue, push: (text: string) => queue.push(forSpeech(text)) };
}

export function speechPieces(buffer: string, final = false): [string[], string] {
  const [sentences, rest] = cutSentences(buffer);
  const pieces: string[] = [];
  // A complete short sentence can go to TTS while the next one is arriving.
  // Bound long, unpunctuated answers too; never silently cut off spoken text.
  const split = (text: string) => {
    while (text.length > 300) {
      const space = text.lastIndexOf(' ', 300);
      const at = space > 0 ? space : 300;
      pieces.push(text.slice(0, at).trim()); text = text.slice(at).trimStart();
    }
    return text;
  };
  for (const sentence of sentences) { const tail = split(sentence); if (tail) pieces.push(tail); }
  buffer = split(rest.trimStart());
  if (final && buffer.trim()) { pieces.push(buffer.trim()); buffer = ''; }
  return [pieces, buffer];
}

// A brief pause ends a turn; a short hesitation while speaking does not.
export const MISO_TURN_SILENCE_MS = 650;

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
  if (options.signal.aborted) return;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record audio. Please use a current browser or type to Miso.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  if (options.signal.aborted) { stream.getTracks().forEach(t => t.stop()); return; }
  let context: AudioContext;
  try { context = await unlockMisoAudio(); } catch (e) { stream.getTracks().forEach(t => t.stop()); throw e; }
  if (options.signal.aborted) { stream.getTracks().forEach(t => t.stop()); return; }
  let source: MediaStreamAudioSourceNode | undefined;
  let analyser: AnalyserNode;
  try {
    source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser(); analyser.fftSize = 1024; source.connect(analyser);
  } catch (e) {
    stream.getTracks().forEach(t => t.stop()); source?.disconnect(); throw e;
  }
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
    stream.getTracks().forEach(t => t.stop()); source?.disconnect(); analyser.disconnect();
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
    const endOfTurn = voiced >= 200 && now - lastLoud >= MISO_TURN_SILENCE_MS;
    const discardQuiet = voiced < 200 && now - begin > 4000;
    if (endOfTurn || discardQuiet || now - begin > 40000) { busy = true; recorder.stop(); }
  }, 50);
}
