import test from 'node:test';
import assert from 'node:assert/strict';
import { composeMisoContext, publicSearchQuery, relevantQuestions, questionContext, wakeCommand } from '../src/lib/miso-context';
import { boundedJSON, CloudError } from '../src/lib/cloud-ai';
import { openCloudMicrophone, speechPieces } from '../src/lib/miso-audio';
import type { Task } from '../src/lib/notion';
const task = (id: string, name: string): Task => ({ id, name, notes: '', heading: 'Java', sourceId: '', done: false, completedOn: null, areaIds: [], topicIds: [], difficulty: null, order: 0, headingOrder: 0, taskOrder: 0, bookmarked: false, revisit: false, links: { tuf: '', leetcode: '', gfg: '', youtube: '', problem: '', resource: '' } });
test('selected question wins and the full sheet remains discoverable', () => {
  const tasks = Array.from({ length: 455 }, (_, i) => task(String(i), `Question ${i}`));
  tasks[454] = task('454', 'Java Collections');
  assert.equal(relevantQuestions(tasks, 'Explain Java Collections')[0].id, '454');
  assert.equal(relevantQuestions(tasks, 'Java', '2')[0].id, '2');
  const context = JSON.parse(questionContext(tasks, [], 'Collections', '454'));
  assert.equal(context.totalQuestions, 455); assert.match(context.catalog, /Java Collections/); assert.equal(context.relevantQuestions[0].id, '454');
});
test('wake phrase must lead the utterance and preserves an accompanying question', () => {
  assert.equal(wakeCommand('Hey Miso, explain binary search.'), 'explain binary search.');
  assert.equal(wakeCommand('Hey Miso!'), '');
  assert.equal(wakeCommand('I told him, hey Miso'), null);
  assert.equal(wakeCommand('Hey misophonia'), null);
});
test('public lookup sends only an explicit bounded search phrase', () => {
  assert.equal(publicSearchQuery('Search the web for Java HashMap complexity'), 'Java HashMap complexity');
  assert.equal(publicSearchQuery('Please look up binary search'), 'binary search');
  assert.equal(publicSearchQuery('Explain this code and maybe search later'), null);
  assert.equal(publicSearchQuery('Search the web for private code {token: 1}'), null);
  assert.equal(publicSearchQuery('Look up ' + 'x'.repeat(181)), null);
});
test('speech chunks preserve content and punctuation', () => {
  const text = 'Binary search repeatedly halves a sorted search space. Compare the midpoint with your target, then retain the half that can contain it. Every step shrinks the interval.';
  const [pieces, rest] = speechPieces(text); const [last] = speechPieces(rest, true);
  assert.equal([...pieces, ...last].join(' '), text); assert.ok(pieces.length);
});
test('body size enforced on actual streamed bytes before parsing', async () => {
  const req = new Request('https://test', { method: 'POST', body: JSON.stringify({ text: 'x'.repeat(200) }) });
  await assert.rejects(boundedJSON(req, 100), (e: unknown) => e instanceof CloudError && e.status === 413);
  assert.deepEqual(await boundedJSON(new Request('https://test', { method: 'POST', body: '{"text":"hi"}' })), { text: 'hi' });
});
test('large notes cannot make a selected-question request exceed the gateway context limit', () => {
  const context = composeMisoContext('progress'.repeat(1000), 'notes'.repeat(30000), 'selected guide'.repeat(2000));
  assert.ok(context.length < 60000);
  assert.ok(context.indexOf('selected guide') < context.indexOf('notes'));
  assert.match(context, /Context shortened/);
});
test('microphone cancellation and setup failures release acquired tracks', async t => {
  let stopped = 0, requested = 0;
  const track = { stop: () => stopped++ };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  let grant!: (value: unknown) => void;
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const oldRecorder = Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder');
  const oldAudio = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => { requested++; return new Promise(resolve => { grant = resolve; }); } } } });
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: class {} });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class { state = 'running'; createMediaStreamSource() { throw new Error('audio graph unavailable'); } } });
  t.after(() => {
    for (const [key, descriptor] of [['navigator', oldNavigator], ['MediaRecorder', oldRecorder], ['AudioContext', oldAudio]] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  });
  const callbacks = { onReady() {}, onSpeech() {}, onTranscribing() {}, async onText() {}, onError() {} };
  const cancelled = new AbortController(); cancelled.abort();
  await openCloudMicrophone({ ...callbacks, signal: cancelled.signal });
  assert.equal(requested, 0, 'already-cancelled sessions must not open a permission prompt');
  const pending = new AbortController();
  const opening = openCloudMicrophone({ ...callbacks, signal: pending.signal });
  pending.abort(); grant(stream); await opening;
  assert.equal(stopped, 1, 'late permission must release its microphone');
  const failing = openCloudMicrophone({ ...callbacks, signal: new AbortController().signal });
  grant(stream);
  await assert.rejects(failing, /audio graph unavailable/);
  assert.equal(stopped, 2, 'audio setup failure must release its microphone');
});
