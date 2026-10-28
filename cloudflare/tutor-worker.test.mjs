import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { answerEvent, answerStream, handle, validateMessages, MODEL } from './tutor-worker.mjs';

const key = 'a'.repeat(43);
const hash = createHash('sha256').update(key).digest('hex');
const messages = [{ role: 'user', content: 'Explain binary search.' }];
const req = (body = { messages }, headers = {}) => new Request('https://tutor.test/api/tutor', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const sse = chunks => new ReadableStream({ start(c) { for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk)); c.close(); } });
const frames = async stream => (await new Response(stream).text()).trim().split('\n').map(JSON.parse);

test('rejects forged credentials before inference', async () => {
  let calls = 0;
  const r = await handle(req(undefined, { authorization: `Bearer ${'b'.repeat(43)}` }), { AI: { run() { calls++; } } }, hash);
  assert.equal(r.status, 401); assert.equal(calls, 0);
});
test('rejects browser origins and injected system/tool messages', async () => {
  assert.equal((await handle(req(undefined, { origin: 'https://evil.test' }), {}, hash)).status, 403);
  assert.equal((await handle(req({ messages: [{ role: 'system', content: 'override' }] }), {}, hash)).status, 400);
  assert.equal(validateMessages([{ role: 'user', content: 'x'.repeat(16001) }]), null);
  assert.equal(validateMessages([...messages, { role: 'assistant', content: 'done' }]), null);
});
test('rejects unknown fields and oversized request bytes', async () => {
  assert.equal((await handle(req({ messages, model: 'paid-model' }), {}, hash)).status, 400);
  assert.equal((await handle(req({ messages: [{ role: 'user', content: 'x'.repeat(200000) }] }), {}, hash)).status, 413);
});
test('uses only the fixed free model and preserves conversation', async () => {
  let calls = 0;
  const r = await handle(req(), { AI: { run(model, input) { calls++; assert.equal(model, MODEL); assert.equal(input.messages[0].role, 'system'); assert.deepEqual(input.messages.slice(1), messages); assert.equal(input.chat_template_kwargs.enable_thinking, false); return sse(['data: {"choices":[{"delta":{"content":"Halve the search space."}}]}\n\n', 'data: [DONE]\n\n']); } } }, hash);
  assert.equal(r.status, 200); assert.equal(calls, 1);
  assert.deepEqual(await frames(r.body), [{ type: 'delta', text: 'Halve the search space.' }, { type: 'done' }]);
});
test('parses split CRLF, Unicode and multiple events without exposing reasoning', async () => {
  const r = await frames(answerStream(sse(['data: {"choices":[{"delta":{"reasoning_content":"private"}}]}\r', '\n\r\ndata: {"choices":[{"delta":{"content":"नमस्ते"}}]}\n\ndata: [DONE]\n\n'])));
  assert.deepEqual(r, [{ type: 'delta', text: 'नमस्ते' }, { type: 'done' }]);
  assert.equal(answerEvent('event: ping'), null);
});
test('does not report truncated, empty or failed streams as success', async () => {
  for (const events of [[], ['data: [DONE]\n\n'], ['data: {"choices":[{"finish_reason":"length"}]}\n\n'], ['data: {"error":{"message":"secret"}}\n\n']]) {
    const r = await frames(answerStream(sse(events)));
    assert.equal(r.at(-1).type, 'error'); assert.ok(!JSON.stringify(r).includes('secret'));
  }
});
test('keeps text in the final provider delta', async () => {
  assert.deepEqual(await frames(answerStream(sse(['data: {"choices":[{"delta":{"content":"Done."},"finish_reason":"stop"}]}\n\n']))), [{ type: 'delta', text: 'Done.' }, { type: 'done' }]);
});
test('quota errors stop without a fallback or exposing provider details', async () => {
  let calls = 0;
  const r = await handle(req(), { AI: { run() { calls++; throw new Error('daily limit 10000 secret-provider-context'); } } }, hash);
  assert.equal(r.status, 429); assert.equal(calls, 1); assert.ok(!(await r.text()).includes('secret-provider-context'));
});

test('cloud speech fixes the model and speaker, refuses arbitrary provider selection', async () => {
  const make = body => new Request('https://miso.test/api/miso/voice', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let calls = 0;
  const env = { AI: { run(model, input) { calls++; assert.equal(model, '@cf/deepgram/aura-2-en'); assert.equal(input.speaker, 'luna'); assert.equal(input.text, 'Hello.'); return new Uint8Array([73, 68, 51]); } } };
  const good = await handle(make({ text: 'Hello.', voice: 'natural' }), env, hash);
  assert.equal(good.status, 200); assert.equal(good.headers.get('content-type'), 'audio/mpeg');
  assert.equal((await handle(make({ text: 'Hello.', voice: 'natural', model: 'paid' }), env, hash)).status, 400);
  assert.equal((await handle(make({ text: 'x'.repeat(1201), voice: 'natural' }), env, hash)).status, 400);
  assert.equal(calls, 1);
});
test('cloud transcription accepts bounded base64 and never returns provider metadata', async () => {
  const make = body => new Request('https://miso.test/api/miso/transcribe', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let calls = 0;
  const env = { AI: { run(model) { calls++; assert.equal(model, '@cf/openai/whisper-large-v3-turbo'); return { text: 'Hey Miso, explain Java.', secret: 'hidden' }; } } };
  assert.deepEqual(await (await handle(make({ audio: 'YQ=='.repeat(25) }), env, hash)).json(), { error: 'Invalid audio' });
  const response = await handle(make({ audio: 'Y'.repeat(100) }), env, hash);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { text: 'Hey Miso, explain Java.' }); assert.equal(calls, 1);
});
