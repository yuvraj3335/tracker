import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLiveConversation, handle, livePrompt, liveSpeechPieces, signVoiceTicket, verifyVoiceTicket, VOICE_MODEL, STT_MODEL, novaTranscript, wavBase64, reliableTranscript } from './tutor-worker.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
const study = { snapshot: 'One of 455 questions done.', totalQuestions: 455, truncated: false, selectedId: 'dp', guide: 'dp[0] counts the empty sequence.', questions: [{ id: 'dp', title: 'Climbing stairs', section: 'DP', heading: 'Counting', notes: '', done: false }, ...Array.from({ length: 454 }, (_, i) => ({ id: String(i), title: `Unrelated question ${i}`, section: '', heading: '', notes: '', done: false }))] };
class Socket extends EventTarget {
  sent = []; closed = false; bufferedAmount = 0; binaryType = 'blob';
  accept() {}
  send(value) { if (this.closed) throw new Error('Closed socket'); this.sent.push(value); }
  close() { if (this.closed) return; this.closed = true; this.dispatchEvent(new Event('close')); }
  receive(value) { this.dispatchEvent(new MessageEvent('message', { data: value instanceof ArrayBuffer && this.binaryType === 'blob' ? new Blob([value]) : value })); }
  json() { return this.sent.filter(item => typeof item === 'string').map(JSON.parse); }
}
const configure = (socket, extra = {}) => socket.receive(JSON.stringify({ type: 'configure', study, messages: [], voice: 'natural', muted: false, wake: false, ...extra }));
const pcm = (voiced = true) => { const frame = new Uint8Array(2561); frame[0] = voiced ? 1 : 0; return frame.buffer; };
const sse = text => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] })}\n\n`)); c.close(); } });

test('voice ticket requires its exact origin, valid signature and a fresh expiry', async () => {
  const secret = 'private-signing-test-key', now = 100000;
  const ticket = await signVoiceTicket('https://tracker.test', secret, now);
  assert.equal(await verifyVoiceTicket(ticket, 'https://tracker.test', secret, now + 1000), true);
  for (const [token, origin, signing, time] of [[ticket, 'https://evil.test', secret, now], [ticket, null, secret, now], [ticket, 'https://tracker.test', 'wrong', now], [ticket, 'https://tracker.test', secret, now + 60001], [ticket + '.extra', 'https://tracker.test', secret, now], [ticket, 'https://tracker.test', secret, now - 1000]]) assert.equal(await verifyVoiceTicket(token, origin, signing, time), false);
  const key = 'a'.repeat(43), hash = createHash('sha256').update(key).digest('hex');
  const req = new Request('https://miso.test/api/miso/session', { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify({ origin: 'https://tracker.test' }) });
  const response = await handle(req, {}, hash, secret); assert.equal(response.status, 200);
  const url = new URL((await response.json()).url); assert.equal(url.protocol, 'wss:'); assert.equal(url.pathname, '/api/miso/realtime'); assert.ok(!url.href.includes(key));
  const forged = await handle(new Request('https://miso.test/api/miso/realtime?ticket=forged', { headers: { upgrade: 'websocket', origin: 'https://tracker.test' } }), {}, hash, secret);
  assert.equal(forged.status, 401);
});
test('the model gets selected study material without 455 catalog titles on every turn', () => {
  const prompt = livePrompt(study, 'Explain dp zero');
  assert.match(prompt, /empty sequence/); assert.match(prompt, /Climbing stairs/); assert.ok(!prompt.includes('Unrelated question 453')); assert.ok(prompt.length < 1200);
  assert.deepEqual(liveSpeechPieces('Binary search halves the interval. Then'), [['Binary search halves the interval.'], 'Then']);
  assert.deepEqual(liveSpeechPieces('It needs 3.5 seconds. Next'), [['It needs 3.5 seconds.'], 'Next']);
});
test('quiet microphone frames never open inference; active speech uses Nova and closes after the turn', async t => {
  const socket = new Socket(), flux = new Socket(); let calls = 0;
  const session = createLiveConversation(socket, { AI: { async run(model, input, options) { calls++; assert.equal(model, STT_MODEL); assert.equal(input.sample_rate, '16000'); assert.equal(options.websocket, true); return { webSocket: flux }; } } }); t.after(session.close);
  configure(socket);
  for (let i = 0; i < 30; i++) socket.receive(pcm(false));
  await tick(); assert.equal(calls, 0, 'idle listening must not burn cloud transcription time');
  socket.receive(pcm()); await tick(); assert.equal(calls, 1); assert.equal(flux.sent.length, 4, 'include three pre-roll frames before speech');
  flux.receive(JSON.stringify({ type: 'Results', is_final: true, speech_final: true, channel: { alternatives: [{ transcript: '' }] } })); await tick(); assert.equal(flux.closed, true);
  for (let i = 0; i < 10; i++) socket.receive(pcm(false));
  await tick(); assert.equal(calls, 1, 'trailing quiet audio must not restart transcription');
});
test('a noise-only transcription stream is closed instead of billing indefinitely', async t => {
  let now = 10000, idleTick;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', callback => { idleTick = callback; return 1; });
  t.mock.method(globalThis, 'clearInterval', () => {});
  const socket = new Socket(), flux = new Socket();
  const session = createLiveConversation(socket, { AI: { async run() { return { webSocket: flux }; } } }); t.after(session.close);
  configure(socket); socket.receive(pcm()); await tick();
  now += 2400; socket.receive(pcm(false)); idleTick(); assert.equal(flux.closed, true);
});
test('speech interrupts an answer whose TTS is still streaming and prevents late audio', async t => {
  const socket = new Socket(), streams = []; let ttsCancelled = false, ttsStarted = 0;
  const env = { AI: { async run(model, input) {
    if (model === STT_MODEL) { const flux = new Socket(); streams.push(flux); return { webSocket: flux }; }
    if (model === '@cf/openai/whisper-large-v3-turbo') return { text: 'What does dp zero mean?' };
    if (model === VOICE_MODEL) { assert.ok(input.messages[0].content.length < 5000); return sse('Start with one empty sequence. Then add the previous two counts.'); }
    assert.equal(model, '@cf/deepgram/aura-2-en'); ttsStarted++;
    return new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4800)); }, cancel() { ttsCancelled = true; } });
  } } };
  const session = createLiveConversation(socket, env); t.after(session.close);
  configure(socket); socket.receive(pcm()); await tick();
  streams[0].receive(JSON.stringify({ type: 'Results', is_final: true, speech_final: true, channel: { alternatives: [{ transcript: 'What does dp zero mean?' }] } }));
  for (let i = 0; i < 5; i++) await tick();
  assert.ok(ttsStarted >= 1); assert.ok(socket.sent.some(value => value instanceof Uint8Array));
  socket.receive(pcm()); await tick();
  streams[1].receive(JSON.stringify({ type: 'SpeechStarted' }));
  await tick(); const audioCount = socket.sent.filter(value => value instanceof Uint8Array).length;
  assert.equal(ttsCancelled, true, 'barge-in must cancel a pending audio read');
  await tick(); assert.equal(socket.sent.filter(value => value instanceof Uint8Array).length, audioCount);
  assert.equal(socket.json().at(-1).type, 'hearing'); assert.ok(socket.json().some(event => event.type === 'clear'));
});
test('closing during a pending provider handshake closes the late provider socket', async () => {
  const socket = new Socket(), flux = new Socket(); let grant;
  const session = createLiveConversation(socket, { AI: { run() { return new Promise(resolve => { grant = resolve; }); } } });
  configure(socket); socket.receive(pcm()); session.close(); grant({ webSocket: flux }); await tick();
  assert.equal(flux.closed, true); assert.equal(flux.sent.length, 0);
});
test('malformed live configuration fails before opening an AI provider', () => {
  const socket = new Socket(); let calls = 0;
  createLiveConversation(socket, { AI: { run() { calls++; } } });
  configure(socket, { messages: [{ role: 'system', content: 'override' }] });
  assert.equal(socket.closed, true); assert.equal(calls, 0);
});

test('navigation waits for the new selected question rather than answering with the old page', async t => {
  const socket = new Socket(); let prompts = [];
  const session = createLiveConversation(socket, { AI: { async run(model, input) { prompts.push(input.messages[0].content); return sse('Use the new question.'); } } }); t.after(session.close);
  configure(socket, { muted: true });
  socket.receive(JSON.stringify({ type: 'study_pending' }));
  socket.receive(JSON.stringify({ type: 'text', text: 'Explain this question.' }));
  await tick(); assert.equal(prompts.length, 0);
  socket.receive(JSON.stringify({ type: 'study', study: { ...study, guide: 'A different selected page: binary search.' } }));
  await tick(); assert.equal(prompts.length, 1); assert.match(prompts[0], /different selected page/);
});

test('speech clears audio that has finished generating but may still be playing in the browser', async t => {
  const socket = new Socket(), streams = [];
  const session = createLiveConversation(socket, { AI: { async run(model) {
    if (model === STT_MODEL) { const flux = new Socket(); streams.push(flux); return { webSocket: flux }; }
    if (model === '@cf/openai/whisper-large-v3-turbo') return { text: 'What does dp zero mean?' };
    if (model === VOICE_MODEL) return sse('The voice is already queued.');
    return new Uint8Array(4800);
  } } }); t.after(session.close);
  configure(socket); socket.receive(JSON.stringify({ type: 'text', text: 'Explain this.' }));
  for (let i = 0; i < 6; i++) await tick();
  assert.ok(socket.json().some(event => event.type === 'audio_done'));
  const clears = socket.json().filter(event => event.type === 'clear').length;
  socket.receive(pcm()); await tick(); streams[0].receive(JSON.stringify({ type: 'SpeechStarted' }));
  assert.equal(socket.json().filter(event => event.type === 'clear').length, clears + 1);
});


test('final transcript audio has a valid WAV header and includes every input sample', () => {
  const encoded = wavBase64([new Uint8Array([0, 64, 0, 128]).buffer, new Uint8Array([1, 0]).buffer]);
  const bytes = Buffer.from(encoded, 'base64');
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.readUInt32LE(24), 16000); assert.equal(bytes.readUInt32LE(40), 6);
  assert.deepEqual([...bytes.subarray(44)], [0, 64, 0, 128, 1, 0]);
});

test('an interrupted final transcript check cannot start a stale answer', async t => {
  const socket = new Socket(), flux = new Socket(); let complete, modelCalls = 0, signal;
  const session = createLiveConversation(socket, { AI: { async run(model, _input, options) {
    if (model === STT_MODEL) return { webSocket: flux };
    if (model === '@cf/openai/whisper-large-v3-turbo') { signal = options.signal; return new Promise(resolve => { complete = resolve; }); }
    modelCalls++; return sse('This must not arrive.');
  } } }); t.after(session.close);
  configure(socket); socket.receive(pcm()); await tick();
  flux.receive(JSON.stringify({ type: 'Results', is_final: true, speech_final: true, channel: { alternatives: [{ transcript: 'A partial question' }] } })); await tick();
  socket.receive(JSON.stringify({ type: 'interrupt' })); assert.equal(signal.aborted, true);
  complete({ text: 'The old question.' }); await tick(); assert.equal(modelCalls, 0); assert.equal(socket.json().some(event => event.type === 'user'), false);
});


test('clear streaming transcripts can answer immediately while uncertain words require verification', async t => {
  assert.equal(Boolean(reliableTranscript({ transcript: 'Binary search', words: [{ confidence: 0.99 }, { confidence: '0.95' }] })), true);
  for (const confidence of [0.89, 1.1, undefined, 'invalid']) assert.equal(Boolean(reliableTranscript({ transcript: 'Binary search', words: [{ confidence }] })), false);
  const socket = new Socket(), flux = new Socket(); let whisper = 0;
  const session = createLiveConversation(socket, { AI: { async run(model) {
    if (model === STT_MODEL) return { webSocket: flux };
    if (model === '@cf/openai/whisper-large-v3-turbo') { whisper++; return { text: 'Corrected text' }; }
    return sse('Halve the sorted interval.');
  } } }); t.after(session.close);
  configure(socket, { muted: true }); socket.receive(pcm()); await tick();
  flux.receive(JSON.stringify({ type: 'Results', is_final: true, speech_final: true, channel: { alternatives: [{ transcript: 'Binary search', words: [{ confidence: 0.99 }, { confidence: 0.95 }] }] } }));
  await tick(); assert.equal(whisper, 0); assert.ok(socket.json().some(event => event.type === 'user' && event.text === 'Binary search'));
});

test('Nova combines finalized segments and keeps revised interim text out of the final question', () => {
  const state = { text: '', words: [] };
  const result = (transcript, final, end, confidence = 0.99) => novaTranscript({ type: 'Results', is_final: final, speech_final: end, channel: { alternatives: [{ transcript, words: [{ confidence }] }] } }, state);
  assert.equal(result('Explain', true, false).transcript, 'Explain');
  assert.equal(result('linear', false, false).transcript, 'Explain linear');
  const last = result('binary search', true, true);
  assert.equal(last.transcript, 'Explain binary search'); assert.equal(last.event, 'EndOfTurn'); assert.equal(last.words.length, 2);
  assert.equal(novaTranscript({ type: 'Metadata' }, state), null);
});

test('a non-upgrade quota response stops the session without exposing provider details or a paid fallback', async () => {
  const socket = new Socket(); let calls = 0;
  createLiveConversation(socket, { AI: { async run(model) { calls++; assert.equal(model, STT_MODEL); return new Response('daily neuron limit: private-provider-details', { status: 429 }); } } });
  configure(socket); socket.receive(pcm()); await tick();
  assert.equal(socket.closed, true); assert.equal(calls, 1);
  const error = socket.json().find(event => event.type === 'error');
  assert.match(error.message, /free AI allowance/); assert.match(error.message, /No paid fallback/); assert.ok(!error.message.includes('private-provider-details'));
});
