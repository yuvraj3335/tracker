import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudSpeechQueue } from '../src/lib/miso-playback';
import { openCloudMicrophone } from '../src/lib/miso-audio';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function audio() {
  const buffers: Float32Array[] = [];
  const sources: { at: number; stopped: boolean; onended: () => void }[] = [];
  const context = {
    state: 'running', currentTime: 10, destination: {},
    createBuffer(_channels: number, length: number, rate: number) {
      const data = new Float32Array(length); buffers.push(data);
      return { duration: length / rate, getChannelData: () => data };
    },
    createBufferSource() {
      const source = { at: 0, stopped: false, onended() {}, connect() {}, disconnect() {},
        start(at: number) { source.at = at; }, stop() { source.stopped = true; source.onended(); } };
      sources.push(source); return source;
    },
    async decodeAudioData() { return { duration: 0.3 }; },
  };
  return { context: context as unknown as AudioContext, buffers, sources };
}
function pcm() {
  let controller!: ReadableStreamDefaultController<Uint8Array>, cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; }, cancel() { cancelled = true; } });
  return { response: new Response(stream, { headers: { 'content-type': 'audio/pcm;rate=24000;channels=1' } }), controller, get cancelled() { return cancelled; } };
}

test('starts playback before the audio body ends, carries split PCM samples, and schedules without gaps', async t => {
  const { context, buffers, sources } = audio(), clip = pcm(), abort = new AbortController();
  let started = 0, request: Record<string, unknown> = {};
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => { request = JSON.parse(String(init?.body)); return clip.response; });
  const queue = cloudSpeechQueue(context, 'natural', abort.signal, () => started++);
  queue.push('Check the middle value.'); await tick();
  const bytes = new Uint8Array(4801);
  for (let i = 0; i < 4800; i += 2) { bytes[i] = 0; bytes[i + 1] = 64; }
  bytes[4800] = 0;
  clip.controller.enqueue(bytes); await tick();
  assert.equal(started, 1, 'must speak while the provider stream is still open');
  assert.equal(sources.length, 1); assert.equal(buffers[0][0], 0.5);
  assert.equal(request.format, 'pcm');
  clip.controller.enqueue(new Uint8Array([128])); clip.controller.close(); await tick();
  assert.equal(buffers[1][0], -1, 'a sample may straddle network chunks');
  assert.equal(sources[1].at, sources[0].at + buffers[0].length / 24000);
  let ended = false; const done = queue.end().then(() => { ended = true; }); await tick();
  assert.equal(ended, false, 'end must wait until scheduled audio finishes');
  sources.forEach(source => source.onended()); await done;
});

test('prefetches only one sentence ahead, keeps order, and cancels unread audio', async t => {
  const { context, sources } = audio(), clips = [pcm(), pcm(), pcm()], abort = new AbortController();
  const called: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => { called.push(JSON.parse(String(init?.body)).text); return clips[called.length - 1].response; });
  const queue = cloudSpeechQueue(context, 'natural', abort.signal, () => {});
  queue.push('First sentence.'); queue.push('Second sentence.'); queue.push('Third sentence.');
  await tick(); assert.deepEqual(called, ['First sentence.', 'Second sentence.']);
  clips[1].controller.enqueue(new Uint8Array(4800));
  await tick(); assert.equal(sources.length, 0, 'a fast second response must not jump ahead');
  clips[0].controller.enqueue(new Uint8Array(4800)); await tick();
  assert.equal(sources.length, 1);
  abort.abort(); await queue.end();
  assert.equal(sources.every(s => s.stopped), true); assert.equal(clips[0].cancelled, true); assert.equal(clips[1].cancelled, true);
  assert.equal(called.length, 2, 'stop must not start queued synthesis requests');
});

test('legacy MP3 still plays, and voice errors stop rather than invoking another service', async t => {
  const { context, sources } = audio();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/mpeg' } }); });
  const queue = cloudSpeechQueue(context, 'longer', new AbortController().signal, () => {});
  queue.push('Hello there.'); await tick(); sources.forEach(source => source.onended()); await queue.end();
  assert.equal(calls, 1); assert.equal(sources.length, 1);
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ error: 'Free allowance reached.' }, { status: 429 }); });
  const failed = cloudSpeechQueue(context, 'natural', new AbortController().signal, () => {});
  failed.push('Hello there.'); await assert.rejects(failed.end(), /Free allowance reached/);
  assert.equal(calls, 2);
});


test('recording waits through a hesitation but submits after 650 ms of silence', async t => {
  let now = 0, loud = true, stops = 0, released = 0;
  let sample!: () => void;
  const track = { stop() { released++; }, addEventListener() {} };
  const original = ['navigator', 'MediaRecorder', 'AudioContext'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  t.after(() => { for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { async getUserMedia() { return { getTracks: () => [track], getAudioTracks: () => [track] }; } } } });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class {
    state = 'running';
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { fftSize: 1024, getFloatTimeDomainData(data: Float32Array) { data.fill(loud ? 0.1 : 0); }, disconnect() {} }; }
  } });
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: class {
    static isTypeSupported() { return true; }
    state = 'inactive';
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; stops++; }
  } });
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', (callback: () => void) => { sample = callback; return 1; });
  t.mock.method(globalThis, 'clearInterval', () => {});
  const controller = new AbortController();
  await openCloudMicrophone({ signal: controller.signal, onReady() {}, onSpeech() {}, onTranscribing() {}, async onText() {}, onError(error) { throw error; } });
  for (let i = 0; i < 4; i++) { now += 50; sample(); }
  loud = false;
  for (let i = 0; i < 12; i++) { now += 50; sample(); }
  assert.equal(stops, 0, 'a pause shorter than the turn boundary should not cut off the speaker');
  now += 50; sample(); assert.equal(stops, 1, 'should submit the turn without the old 1.2-second wait');
  controller.abort(); assert.equal(released, 1);
});
