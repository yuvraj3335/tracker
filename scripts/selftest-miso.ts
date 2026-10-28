import test from 'node:test';
import assert from 'node:assert/strict';
import { relevantQuestions, questionContext, wakeCommand } from '../src/lib/miso-context';
import { boundedJSON, CloudError } from '../src/lib/cloud-ai';
import { speechPieces } from '../src/lib/miso-audio';
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
