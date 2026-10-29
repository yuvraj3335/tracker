/** Cloud audio playback only. PCM avoids waiting for a complete MP3 to decode. */
export function cloudSpeechQueue(context: AudioContext | null, voice: 'natural' | 'longer', signal: AbortSignal, onStart: () => void) {
  const cancel = new AbortController();
  const session = AbortSignal.any([signal, cancel.signal]);
  let chain = Promise.resolve(), nextTime = 0, started = false;
  let failure: Error | null = null;
  const active = new Set<AudioBufferSourceNode>();
  const endings = new Set<Promise<void>>();
  const responses = new Set<Response>();
  type Prepared = { response?: Response; error?: Error };
  const waiting: { text: string; resolve: (result: Prepared) => void }[] = [];
  let preparing = 0;

  const stop = () => {
    for (const source of active) { try { source.stop(); } catch { /* Already ended. */ } }
    for (const response of responses) { if (!response.body?.locked) void response.body?.cancel().catch(() => {}); }
    for (const job of waiting.splice(0)) job.resolve({ error: new Error('Playback stopped.') });
  };
  session.addEventListener('abort', stop, { once: true });

  // At most the current sentence and one following sentence are in flight.
  const prepare = () => {
    while (!session.aborted && preparing < 2 && waiting.length) {
      const job = waiting.shift()!; preparing++;
      void fetch('/api/companion/voice', {
        method: 'POST', signal: session, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: job.text, voice, ...(voice === 'natural' ? { format: 'pcm' } : {}) }),
      }).then(response => {
        if (session.aborted) { void response.body?.cancel().catch(() => {}); job.resolve({ error: new Error('Playback stopped.') }); }
        else { responses.add(response); job.resolve({ response }); }
      }, error => job.resolve({ error }));
    }
  };

  const schedule = (buffer: AudioBuffer) => {
    if (session.aborted || !context) return;
    const source = context.createBufferSource();
    source.buffer = buffer; source.connect(context.destination); active.add(source);
    let finish!: () => void;
    const ending = new Promise<void>(resolve => { finish = resolve; });
    endings.add(ending);
    source.onended = () => { active.delete(source); endings.delete(ending); source.disconnect(); finish(); };
    // Schedule adjoining chunks on the audio clock, not delayed JS onended callbacks.
    nextTime = Math.max(nextTime, context.currentTime + 0.04);
    try { source.start(nextTime); } catch (error) {
      active.delete(source); endings.delete(ending); source.disconnect(); finish(); throw error;
    }
    nextTime += buffer.duration;
    if (!started) { started = true; onStart(); }
  };

  const readPCM = async (response: Response) => {
    if (!response.body || !context) throw new Error('No speech was returned.');
    const reader = response.body.getReader();
    let pending = new Uint8Array(0), samples = 0, first = true;
    const abortRead = () => { void reader.cancel().catch(() => {}); };
    session.addEventListener('abort', abortRead, { once: true });
    try {
      for (;;) {
        const part = await reader.read();
        if (session.aborted) return;
        if (part.value) {
          const joined = new Uint8Array(pending.length + part.value.length);
          joined.set(pending); joined.set(part.value, pending.length); pending = joined;
        }
        // 100 ms of audio smooths tiny network chunks without buffering the sentence.
        if (pending.length >= 4800 || part.done) {
          if (first && pending.length >= 4 && new TextDecoder().decode(pending.subarray(0, 4)) === 'RIFF') throw new Error('The voice service returned an unexpected audio format.');
          const count = Math.floor(pending.length / 2);
          if (count) {
            first = false;
            const buffer = context.createBuffer(1, count, 24000), channel = buffer.getChannelData(0);
            const data = new DataView(pending.buffer, pending.byteOffset, count * 2);
            for (let i = 0; i < count; i++) channel[i] = data.getInt16(i * 2, true) / 32768;
            samples += count; schedule(buffer); pending = pending.slice(count * 2);
          }
        }
        if (part.done) {
          if (!samples || pending.length) throw new Error('The voice audio was incomplete. Please retry.');
          break;
        }
      }
    } finally { session.removeEventListener('abort', abortRead); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  };

  return {
    push(text: string) {
      if (!text.trim() || session.aborted || failure) return;
      const ready = new Promise<Prepared>(resolve => { waiting.push({ text, resolve }); });
      prepare();
      chain = chain.then(async () => {
        const { response, error } = await ready;
        try {
          if (session.aborted) return;
          if (error) throw error;
          if (!context || context.state !== 'running') throw new Error('Tap Talk to enable audio playback.');
          if (!response?.ok) {
            const data = await response?.json().catch(() => null);
            throw new Error(typeof data?.error === 'string' ? data.error : 'Cloud voice is unavailable.');
          }
          if (response.headers.get('content-type') === 'audio/pcm;rate=24000;channels=1') await readPCM(response);
          else if (response.headers.get('content-type')?.startsWith('audio/mpeg')) schedule(await context.decodeAudioData(await response.arrayBuffer()));
          else throw new Error('The voice service returned an unexpected audio format.');
        } finally {
          if (response) { responses.delete(response); if (!response.body?.locked) await response.body?.cancel().catch(() => {}); }
          preparing--; prepare();
        }
      }).catch(error => {
        if (!session.aborted) { failure = error instanceof Error ? error : new Error('Cloud voice is unavailable.'); cancel.abort(); }
      });
    },
    async end() {
      try {
        await chain; await Promise.all(endings);
        if (failure && !signal.aborted) throw failure;
      } finally { session.removeEventListener('abort', stop); }
    },
  };
}
