import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { openMisoLive, livePCMPlayer } from '../src/lib/miso-live';
import { bindVisibleMicrophone } from '../src/lib/miso-visibility';

test('visible-tab listening pauses on tab departure, resumes on return, and honors manual Off', () => {
  class Page extends EventTarget { hidden = false; }
  const page = new Page(); let enabled = true, starts = 0, pauses = 0;
  const detach = bindVisibleMicrophone(page as unknown as Document, () => enabled, () => starts++, () => pauses++);
  assert.equal(starts, 1, 'request permission on the first visible visit');
  page.hidden = true; page.dispatchEvent(new Event('visibilitychange')); assert.equal(pauses, 1);
  page.hidden = false; page.dispatchEvent(new Event('visibilitychange')); assert.equal(starts, 2, 'returning should not need another button');
  enabled = false; page.hidden = true; page.dispatchEvent(new Event('visibilitychange')); page.hidden = false; page.dispatchEvent(new Event('visibilitychange')); assert.equal(starts, 2);
  detach(); enabled = true; page.dispatchEvent(new Event('visibilitychange')); assert.equal(starts, 2);
});
test('capture worklet produces ordered 80ms, 16kHz PCM frames at 48kHz and 44.1kHz without local inference', async () => {
  const source = await readFile('public/miso-capture.js', 'utf8');
  for (const rate of [48000, 44100]) {
    const frames: { pcm: ArrayBuffer; rms: number }[] = []; let Processor!: new () => { process(input: Float32Array[][]): boolean };
    runInNewContext(source, { sampleRate: rate, AudioWorkletProcessor: class { port = { postMessage(value: typeof frames[number]) { frames.push(value); } }; }, registerProcessor(_name: string, implementation: typeof Processor) { Processor = implementation; } });
    const processor = new Processor();
    for (let i = 0; i < rate; i += 128) processor.process([[new Float32Array(Math.min(128, rate - i)).fill(0.25)]]);
    assert.equal(frames.length, 12); assert.equal(frames[0].pcm.byteLength, 2560); assert.ok(Math.abs(frames[0].rms - 0.25) < 0.001);
    assert.equal(new DataView(frames[0].pcm).getInt16(0, true), 8192);
  }
});
test('the live client keeps capturing during playback, interrupts by speech, ignores stale audio, and releases a late mic grant', async t => {
  let stopped = 0, disconnected = 0, speaking = 0, errors = 0;
  const captures: { port: { onmessage: ((event: { data: unknown }) => void) | null; close(): void }; disconnect(): void }[] = [];
  const sockets: FakeSocket[] = [], sources: { stopped: boolean; stop(): void }[] = [];
  const old = ['navigator', 'AudioContext', 'AudioWorkletNode', 'WebSocket'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  t.after(() => { for (const [key, descriptor] of old) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  const stream = { getTracks: () => [{ stop() { stopped++; } }], getAudioTracks: () => [{ addEventListener() {} }] };
  let grant: ((value: unknown) => void) | null = null;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => grant === null ? Promise.resolve(stream) : new Promise(resolve => { grant = resolve; }) } } });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class {
    state = 'running'; currentTime = 0; destination = {};
    audioWorklet = { async addModule() {} };
    createMediaStreamSource() { return { connect() {}, disconnect() { disconnected++; } }; }
    createBuffer(_channels: number, count: number, rate: number) { return { duration: count / rate, getChannelData: () => new Float32Array(count) }; }
    createBufferSource() { const node = { stopped: false, onended() {}, connect() {}, disconnect() {}, start() {}, stop() { node.stopped = true; node.onended(); } }; sources.push(node); return node; }
  } });
  Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, value: class {
    port = { onmessage: null, close() {} };
    constructor() { captures.push(this); }
    connect() {} disconnect() { disconnected++; }
  } });
  class FakeSocket {
    static OPEN = 1; static CLOSING = 2;
    readyState = 0; bufferedAmount = 0; binaryType = ''; sent: unknown[] = [];
    onopen: (() => void) | null = null; onmessage: ((event: { data: unknown }) => void) | null = null; onclose: (() => void) | null = null;
    constructor() { sockets.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
    send(value: unknown) { this.sent.push(value); if (typeof value === 'string' && JSON.parse(value).type === 'configure') queueMicrotask(() => this.emit({ type: 'ready' })); }
    emit(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeSocket });
  const study = { snapshot: 'Test', questions: [], guide: '', selectedId: null, truncated: false, totalQuestions: 0 };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ url: 'wss://voice.test/live', study }));
  const abort = new AbortController();
  const callbacks = { questionId: undefined, messages: [], voice: 'natural' as const, muted: false, wake: false, onEvent() {}, onSpeaking() { speaking++; }, onIdle() {}, onSpeech() {}, onReady() {}, onError() { errors++; }, onSources() {} };
  const session = await openMisoLive({ ...callbacks, signal: abort.signal });
  const socket = sockets[0]; socket.emit({ type: 'answer_start', turn: 1 });
  const frame = new Uint8Array(4805); new DataView(frame.buffer).setUint32(0, 1);
  socket.onmessage?.({ data: frame.buffer }); assert.equal(speaking, 1); assert.equal(stopped, 0);
  const pcm = new ArrayBuffer(2560);
  captures[0].port.onmessage?.({ data: { pcm, rms: 0.1 } }); captures[0].port.onmessage?.({ data: { pcm, rms: 0.1 } });
  assert.equal(stopped, 0, 'barge-in must keep the microphone alive');
  assert.equal(sources[0].stopped, true); assert.ok(socket.sent.some(value => typeof value === 'string' && JSON.parse(value).type === 'interrupt'));
  socket.onmessage?.({ data: frame.buffer }); assert.equal(speaking, 1, 'late audio must not restart the interrupted reply');
  socket.emit({ type: 'answer_start', turn: 3 }); new DataView(frame.buffer).setUint32(0, 3); socket.onmessage?.({ data: frame.buffer }); assert.equal(speaking, 2);
  abort.abort(); assert.equal(stopped, 1); assert.equal(socket.readyState, 3); assert.equal(disconnected, 2); assert.equal(errors, 0);
  session.close(); assert.equal(stopped, 1);
  grant = () => {};
  const lateAbort = new AbortController(), late = openMisoLive({ ...callbacks, signal: lateAbort.signal });
  lateAbort.abort(); grant(stream); await assert.rejects(late, error => (error as Error).name === 'AbortError');
  assert.equal(stopped, 2, 'leaving the tab while permission is pending must release the eventual mic grant');
  assert.equal(sockets.length, 1, 'cancelled permission must not open a live connection');
});
test('PCM playback flushes partial frames and clears all scheduled audio', () => {
  let began = 0, idle = 0, stopped = 0;
  const context = { currentTime: 0, destination: {}, createBuffer(_channels: number, count: number, rate: number) { return { duration: count / rate, getChannelData: () => new Float32Array(count) }; }, createBufferSource() { return { connect() {}, disconnect() {}, start() {}, stop() { stopped++; } }; } } as unknown as AudioContext;
  const player = livePCMPlayer(context, () => began++, () => idle++);
  player.push(new Uint8Array([0, 64])); assert.equal(began, 0); player.finish(); assert.equal(began, 1); assert.equal(idle, 0);
  player.clear(); assert.equal(stopped, 1); assert.equal(player.playing, false);
});
