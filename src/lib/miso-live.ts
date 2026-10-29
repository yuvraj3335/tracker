'use client';
import { unlockMisoAudio } from './miso-audio';
import type { ChatMessage } from './companion-prompt';
import type { LiveStudy } from './miso-live-study';
import type { Reference } from './tutor';

type LiveEvent = { type: string; turn?: number; text?: string; message?: string; query?: string };
type Options = {
  signal: AbortSignal; questionId?: string; messages: ChatMessage[];
  voice: 'natural' | 'longer'; muted: boolean; wake: boolean;
  onEvent: (event: LiveEvent) => void; onSpeaking: () => void; onIdle: () => void;
  onSpeech: () => void; onReady: () => void; onError: (error: Error) => void;
  onSources: (references: Reference[], warning: string | null) => void;
};
export type LiveConnection = Awaited<ReturnType<typeof openMisoLive>>;
const modules = new WeakMap<AudioContext, Promise<void>>();

/** Incoming PCM is played before a complete utterance exists, on the audio clock. */
export function livePCMPlayer(context: AudioContext, onStart: () => void, onIdle: () => void) {
  let pending = new Uint8Array(0), nextAt = 0, finished = false, announced = false;
  const sources = new Set<AudioBufferSourceNode>();
  const play = (buffer: AudioBuffer) => {
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); sources.add(source);
    source.onended = () => { if (!sources.delete(source)) return; source.disconnect(); if (!sources.size && finished) { announced = false; onIdle(); } };
    nextAt = Math.max(nextAt, context.currentTime + 0.04);
    try { source.start(nextAt); } catch (error) { sources.delete(source); source.disconnect(); throw error; }
    nextAt += buffer.duration;
    if (!announced) { announced = true; onStart(); }
  };
  const flush = () => {
    const count = Math.floor(pending.length / 2); if (!count) return;
    const buffer = context.createBuffer(1, count, 24000), data = buffer.getChannelData(0), view = new DataView(pending.buffer, pending.byteOffset, count * 2);
    for (let i = 0; i < count; i++) data[i] = view.getInt16(i * 2, true) / 32768;
    pending = pending.slice(count * 2); play(buffer);
  };
  return {
    push(bytes: Uint8Array) {
      const joined = new Uint8Array(pending.length + bytes.length); joined.set(pending); joined.set(bytes, pending.length); pending = joined;
      if (pending.length >= 4800) flush();
    },
    play,
    finish() { finished = true; flush(); if (pending.length) throw new Error('Voice audio was interrupted.'); if (!sources.size) { announced = false; onIdle(); } },
    clear() { const old = [...sources]; sources.clear(); old.forEach(source => { source.disconnect(); try { source.stop(); } catch { /* Already stopped. */ } }); pending = new Uint8Array(0); nextAt = 0; finished = false; announced = false; },
    get playing() { return sources.size > 0; },
  };
}

export async function openMisoLive(options: Options) {
  const controller = new AbortController(), signal = AbortSignal.any([options.signal, controller.signal]);
  let socket: WebSocket | null = null, stream: MediaStream | null = null, capture: AudioWorkletNode | null = null, source: MediaStreamAudioSourceNode | null = null;
  let player: ReturnType<typeof livePCMPlayer> | null = null, closed = false, turn = -1, blockedTurn = -1, loudFrames = 0;
  let studyController: AbortController | null = null, refresh: ReturnType<typeof setInterval> | null = null;
  let preferences = { voice: options.voice, muted: options.muted, wake: options.wake }, questionId = options.questionId;
  let lastStudy: LiveStudy | null = null, decode = Promise.resolve();
  const send = (value: unknown) => { if (socket?.readyState === WebSocket.OPEN && !signal.aborted) socket.send(JSON.stringify(value)); };
  const cleanup = () => {
    if (closed) return;
    closed = true; controller.abort(); studyController?.abort();
    if (refresh) clearInterval(refresh);
    player?.clear(); capture?.disconnect(); source?.disconnect(); capture?.port.close();
    stream?.getTracks().forEach(track => track.stop());
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Microphone paused');
    signal.removeEventListener('abort', cleanup);
  };
  const fail = (error: unknown) => { if (closed || options.signal.aborted) return; cleanup(); options.onError(error instanceof Error ? error : new Error('Live voice disconnected.')); };
  signal.addEventListener('abort', cleanup, { once: true });
  const prepareStudy = async (connect: boolean) => {
    studyController?.abort(); const next = new AbortController(); studyController = next;
    const response = await fetch('/api/companion/live', { method: 'POST', signal: AbortSignal.any([signal, next.signal]), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ connect, ...(questionId ? { questionId } : {}) }) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Miso could not connect.');
    if (signal.aborted || next.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    lastStudy = value.study;
    if (!connect) send({ type: 'study', study: lastStudy });
    return value as { url?: string; study: LiveStudy };
  };
  const ticketRequestedAt = Date.now();
  const prepared = prepareStudy(true).then(value => ({ value }), error => ({ error }));
  try {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') throw new Error('Live voice needs a current Safari, Chrome, Edge, or Firefox browser. You can still type to Miso.');
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    if (signal.aborted) { stream.getTracks().forEach(track => track.stop()); throw new DOMException('Cancelled', 'AbortError'); }
    let unlockTimer: ReturnType<typeof setTimeout> | undefined;
    const context = await Promise.race([unlockMisoAudio(), new Promise<never>((_, reject) => { unlockTimer = setTimeout(() => reject(new Error('Tap Enable microphone once to allow audio playback.')), 2000); })]).finally(() => clearTimeout(unlockTimer));
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    let loaded = modules.get(context);
    if (!loaded) { loaded = context.audioWorklet.addModule('/miso-capture.js'); modules.set(context, loaded); loaded.catch(() => modules.delete(context)); }
    await loaded;
    let result = await prepared;
    if ('error' in result) throw result.error;
    // Permission prompts may remain open longer than a connection ticket lives.
    if (Date.now() - ticketRequestedAt > 45000) result = { value: await prepareStudy(true) };
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!result.value.url || new URL(result.value.url).protocol !== 'wss:') throw new Error('Miso returned an invalid connection.');
    player = livePCMPlayer(context, options.onSpeaking, () => { options.onIdle(); });
    socket = new WebSocket(result.value.url); socket.binaryType = 'arraybuffer';
    const interrupt = () => { blockedTurn = turn; player?.clear(); send({ type: 'interrupt' }); };
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Miso could not establish live voice. Please retry.')), 12000);
      const aborted = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
      signal.addEventListener('abort', aborted, { once: true });
      socket!.onopen = () => send({ type: 'configure', study: lastStudy, messages: options.messages.slice(-12), ...preferences });
      socket!.onmessage = event => {
        if (closed || signal.aborted) return;
        try {
          if (event.data instanceof ArrayBuffer) {
            const data = new Uint8Array(event.data); if (data.length < 6) throw new Error('Invalid voice audio.');
            const id = new DataView(data.buffer).getUint32(0); if (id !== turn || id === blockedTurn) return;
            if (data[4] === 0) player!.push(data.subarray(5));
            else if (data[4] === 1) {
              const bytes = data.slice(5).buffer;
              decode = decode.then(async () => { const buffer = await context.decodeAudioData(bytes); if (!closed && turn === id && blockedTurn !== id) player!.play(buffer); }).catch(fail);
            } else throw new Error('Unknown voice audio format.');
            return;
          }
          const value = JSON.parse(event.data) as LiveEvent;
          if (value.type === 'ready') { clearTimeout(timer); signal.removeEventListener('abort', aborted); resolve(); return; }
          if (value.type === 'error') { const error = new Error(value.message || 'Live voice failed.'); clearTimeout(timer); reject(error); fail(error); return; }
          if (value.type === 'renew') { options.onEvent(value); cleanup(); return; }
          if (value.type === 'disabled') { options.onEvent(value); cleanup(); return; }
          if (value.type === 'clear') { turn = value.turn ?? turn; player!.clear(); }
          if (value.type === 'answer_start') { turn = value.turn!; blockedTurn = -1; player!.clear(); }
          if (value.type === 'audio_done' && value.turn === turn && value.turn !== blockedTurn) void decode.then(() => { if (!closed && turn === value.turn && blockedTurn !== turn) player!.finish(); }).catch(fail);
          if (value.type === 'lookup' && value.query && value.turn !== undefined) {
            const id = value.turn;
            void fetch('/api/companion/lookup', { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: value.query }) }).then(async response => {
              if (!response.ok) throw new Error('Public lookup was unavailable.'); return response.json();
            }).then(result => { if (!closed && turn === id) { const references = (result.references ?? []).map((r: Reference) => ({ title: r.title.slice(0, 160), url: r.url.slice(0, 400), excerpt: r.excerpt.slice(0, 700) })); options.onSources(references, result.warning ?? null); send({ type: 'references', turn: id, references }); } }).catch(error => { if (!signal.aborted && turn === id) { options.onSources([], error.message); send({ type: 'references', turn: id, references: [] }); } });
          }
          options.onEvent(value);
        } catch (error) { fail(error); }
      };
      socket!.onerror = () => { const error = new Error('Miso’s live connection failed. Tap Enable microphone to reconnect.'); clearTimeout(timer); reject(error); fail(error); };
      socket!.onclose = () => { if (!closed && !signal.aborted) { const error = new Error('Live voice disconnected. Tap Enable microphone to reconnect.'); clearTimeout(timer); reject(error); fail(error); } };
    });
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    source = context.createMediaStreamSource(stream); capture = new AudioWorkletNode(context, 'miso-capture');
    source.connect(capture); capture.connect(context.destination);
    capture.port.onmessage = event => {
      if (signal.aborted || closed || socket?.readyState !== WebSocket.OPEN) return;
      try {
        const { pcm, rms } = event.data as { pcm: ArrayBuffer; rms: number };
        const loud = rms > (player!.playing ? 0.025 : 0.012);
        loudFrames = loud ? loudFrames + 1 : 0;
        // Two sustained frames ignore clicks while cutting off a reply in ~160 ms.
        if (loudFrames === 2) { interrupt(); options.onSpeech(); }
        // A context update can contain the full catalog; do not mistake it for audio backlog.
        if (socket.bufferedAmount > 768000) throw new Error('Audio upload is too slow. Please reconnect on a stronger connection.');
        const frame = new Uint8Array(pcm.byteLength + 1); frame[0] = loud ? 1 : 0; frame.set(new Uint8Array(pcm), 1); socket.send(frame);
      } catch (error) { fail(error); }
    };
    stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => { if (!closed) fail(new Error('The microphone was disconnected. Tap Enable microphone to reconnect.')); }));
    options.onReady();
    refresh = setInterval(() => { void prepareStudy(false).catch(error => { if (!signal.aborted && error.name !== 'AbortError') options.onSources([], 'Tracker context could not refresh. Reconnect to load updated questions.'); }); }, 60000);
    return {
      send(text: string) { interrupt(); send({ type: 'text', text }); },
      interrupt,
      preferences(next: typeof preferences) { const wasMuted = preferences.muted; preferences = next; if (next.muted && !wasMuted) interrupt(); send({ type: 'preferences', ...preferences }); },
      updateQuestion(next?: string) { if (questionId === next) return; questionId = next; send({ type: 'study_pending' }); void prepareStudy(false).catch(error => { if (!signal.aborted && error.name !== 'AbortError') fail(error); }); },
      close: cleanup,
    };
  } catch (error) { cleanup(); throw error; }
}
