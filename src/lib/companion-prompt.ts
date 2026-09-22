/**
 * What the companion is told about itself, and what it is allowed to say.
 *
 * Pure, so the two things that actually matter can be tested: that the
 * character's own voice reaches the model, and that the model is told in
 * plain terms that it does not know the user's progress — because the one
 * unacceptable failure here is a companion that cheerfully invents a streak.
 */
import type { Character } from './characters';

/** Roles the client is allowed to send. `system` is ours alone. */
export type ChatRole = 'user' | 'assistant';
export type ChatMessage = { role: ChatRole; content: string };

/** Kept short: this is a conversation, not a document. */
export const MAX_MESSAGE_CHARS = 1200;
export const MAX_HISTORY = 12;
export const MAX_REPLY_CHARS = 700;

const BASE = [
  'You are a small apprentice wizard who keeps someone company while they work through coding-interview practice questions.',
  'You are warm, brief and a little playful. Two or three sentences at most, and never a list.',
  'You are speaking out loud, so write plainly: no markdown, no headings, no code blocks, no emoji spam.',
  // The one hard rule. A companion that invents a streak is worse than no
  // companion, because the whole app is built on one honest source of truth.
  'You do NOT have access to their tracker, their progress, their streak or how many questions they have done. Never state or guess any of those numbers. If asked, say plainly that you cannot see their progress from here and point them at the dashboard.',
  'If they ask for help with a specific problem, give the idea or the approach rather than a full solution, and keep it to a couple of sentences.',
].join(' ');

/**
 * The system prompt, in this character's voice where it has one.
 *
 * A character's `lines` are the same copy the celebration overlay speaks, so
 * quoting a few of them is the cheapest way to make the companion sound like
 * the thing on screen rather than a generic assistant — and it means a
 * character that ships its own voice gets it here for free, with no second
 * place to configure.
 */
export function systemPrompt(character: Character | null | undefined): string {
  const name = character?.name?.trim();
  const parts = [BASE];
  if (name) parts.push(`Your name is ${name}.`);

  const samples = [
    ...(character?.lines?.cheer ?? []),
    ...(character?.lines?.idle ?? []),
  ]
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);
  if (samples.length) {
    parts.push(`For tone, these are things you say: ${samples.map((l) => `"${l}"`).join(' ')}`);
  }
  return parts.join(' ');
}

/**
 * Validates and trims what the client sent.
 *
 * Returns null rather than throwing for anything unusable: this reads straight
 * off a request body, and the caller's job is to answer with copy rather than
 * a stack trace. Only the most recent turns survive, oldest dropped first, so
 * a long conversation cannot grow the prompt without bound.
 */
export function sanitiseHistory(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: ChatMessage[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const { role, content } = entry as Record<string, unknown>;
    if (role !== 'user' && role !== 'assistant') return null;
    if (typeof content !== 'string') return null;
    const text = content.trim();
    if (!text) continue;
    out.push({ role, content: text.slice(0, MAX_MESSAGE_CHARS) });
  }
  if (!out.length) return null;
  // The last message has to be the user's, or there is nothing to answer.
  if (out[out.length - 1].role !== 'user') return null;
  return out.slice(-MAX_HISTORY);
}

/**
 * Tidies a reply for the screen and for being read aloud.
 *
 * Collapses the whitespace a model uses for layout, strips the markdown
 * emphasis it reaches for anyway despite being asked not to, and caps the
 * length so speech synthesis cannot start a monologue there is no way to
 * skip past.
 */
export function tidyReply(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const text = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= MAX_REPLY_CHARS) return text;
  // Cut at a sentence end where there is one nearby, so it does not stop
  // mid-word.
  const cut = text.slice(0, MAX_REPLY_CHARS);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (stop > MAX_REPLY_CHARS * 0.6 ? cut.slice(0, stop + 1) : cut.trimEnd()) + '';
}
