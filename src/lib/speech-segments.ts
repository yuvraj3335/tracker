/** Sentence boundaries shared by browser and cloud speech. No audio engines. */
export const SENTENCE_MIN = 10;

/** The first sentence may be shorter so streaming speech can start promptly. */
export const FIRST_MIN = 3;

/**
 * Pulls finished sentences out of a buffer that is still being written to.
 *
 * The reply arrives a few characters at a time, and the whole point is to
 * start speaking before it has finished arriving. This returns the sentences
 * that are definitely complete and whatever is left over, so the leftover can
 * wait for the rest of itself.
 *
 * A sentence is only complete when something follows the full stop — without
 * that rule "3." in "3.5" would be a sentence, and so would every half-typed
 * abbreviation. `min` keeps a stray "Oh." from becoming its own utterance with
 * all the gap that implies; the caller lowers it for the first sentence of a
 * reply, where that gap is the thing being avoided rather than the cost.
 */
export function cutSentences(buffer: string, min = SENTENCE_MIN): [string[], string] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length - 1; i++) {
    const c = buffer[i];
    if (c !== '.' && c !== '!' && c !== '?' && c !== '\n') continue;
    // Run past "?!" and "..." so they stay with the sentence they belong to.
    let end = i;
    while (end + 1 < buffer.length && '.!?'.includes(buffer[end + 1])) end++;
    // Something has to follow it, and whitespace is the only thing that
    // counts. A buffer that stops dead on the terminator has not finished the
    // sentence — it has stopped mid-arrival, and "You have done 3." is the
    // shape that proves it: cut there and the "5 hours" that was coming next
    // becomes a sentence of its own.
    const after = buffer[end + 1];
    if (after === undefined || !/\s/.test(after)) continue;
    const sentence = buffer.slice(start, end + 1).trim();
    if (sentence.length < min) continue;
    out.push(sentence);
    start = end + 1;
    i = end;
  }
  return [out, buffer.slice(start)];
}

