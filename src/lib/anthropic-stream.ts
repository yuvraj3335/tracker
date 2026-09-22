/**
 * Anthropic's event stream, reduced to the words.
 *
 * The wire format is server-sent events carrying a JSON envelope per token.
 * None of that is any use to a voice, so it is unwrapped and what reaches the
 * browser is plain text arriving in pieces — which is all the client needs to
 * cut into sentences and start speaking before the reply has finished being
 * written.
 *
 * Pure and working on strings, so the parsing can be tested without a network
 * or a key. It is the part most likely to be quietly wrong: a stream that
 * silently yields nothing looks exactly like a model with nothing to say.
 */

/** One event block, split off a buffer. Events are separated by a blank line. */
export function splitEvents(buffer: string): [string[], string] {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  return [parts, rest];
}

/**
 * The text carried by one event block, if any.
 *
 * Every other event type — message_start, ping, content_block_stop, the
 * usage totals — is real and expected and carries nothing to say, so the
 * common case here is returning nothing at all.
 */
export function textOfEvent(event: string): string {
  let out = '';
  for (const line of event.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;

    let parsed: { type?: unknown; delta?: { type?: unknown; text?: unknown } };
    try {
      parsed = JSON.parse(payload);
    } catch {
      // A half-arrived event is not an error, it is a later event. Dropping
      // it here would be wrong, but splitEvents has already made sure a
      // partial block stays in the buffer, so anything unparseable at this
      // point is genuinely malformed and skipping it is right.
      continue;
    }

    // Only text deltas. `input_json_delta` and friends are not speech, and
    // reading `delta.text` without checking the type would one day splice a
    // fragment of tool arguments into the middle of a sentence.
    const delta = parsed.delta;
    if (!delta || (delta.type !== undefined && delta.type !== 'text_delta')) continue;
    if (typeof delta.text === 'string') out += delta.text;
  }
  return out;
}
