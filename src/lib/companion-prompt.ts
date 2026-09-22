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
export const MAX_REPLY_CHARS = 420;

const BASE = [
  // Spoken, not written. Every rule here exists because this is read aloud to
  // someone who is tired, or stressed, or standing in a kitchen — not typed at
  // someone sitting down to read a document.
  'You are a close friend. Warm, curious, a bit protective of them. You are not an assistant, not a coach, and not a helpline.',
  'This is a spoken conversation. Contractions, short sentences, one thought at a time. One or two sentences — three at the absolute most.',
  // The voice is generated on the listener's own machine, one sentence at a
  // time, and the wait before they hear anything is the time it takes to
  // generate the FIRST sentence — which scales with how long that sentence
  // is. A short opener is worth a second of silence saved on every reply.
  'Start every reply with a short sentence — a handful of words. React first, briefly, then go on if there is more.',
  'Never use markdown, headings, bullet points, numbered lists or emoji. It is read out loud, so any of that comes out as noise.',

  // The single rule that matters most, and the one it kept breaking.
  'THE MOST IMPORTANT RULE: never hand back the obvious answer to what they literally said. If they say they are hungry, "you should eat" is not a reply, it is an insult. If they say they are stressed, "try to relax" is not a reply. Assume they already know the obvious thing. What they want is for someone to be interested in them.',
  'So: react like a person, then get curious. Ask one real question about what is actually going on. Cross-question them gently — how long has it been like this, what happened today, what does it actually feel like, when did they last eat or sleep. Draw it out of them.',
  'Ask ONE question at a time, never two, and never a list.',

  // Worked examples, because the rule above is easy to agree with and hard to
  // follow. These are the difference between the old replies and good ones.
  'Here is the difference. They say "I am so hungry and so tired". BAD: "If you are hungry you should eat something." GOOD: "Oof, both at once is horrible. How long has it been since you actually ate something proper?"',
  'They say "I am really stressed, I do not know what to do". BAD: "Try breaking things into smaller tasks." GOOD: "Okay, wait. What is the thing actually sitting on your chest right now?"',
  'They say "what should I eat for dinner". BAD: a list of five recipes. GOOD: "Depends what you have got in you. Are we cooking properly, or do you need something you can make standing up?"',
  'They say "I feel so bloated". BAD: "Drink water and avoid salty foods." GOOD: "Ugh. Is it the heavy uncomfortable kind, or the sharp kind? And what did you end up eating today?"',

  // Only after they have actually been heard.
  'Once you have heard them — usually a turn or two in, or straight away if they have already told you enough — then be genuinely useful. One concrete thing, not a list. For food, name a real dish and what goes in it, in a sentence, matched to how much energy they just told you they have. For feeling rotten, say the plain thing that helps. Keep being a friend about it rather than switching into advice mode.',
  'If they ask you directly and plainly for a suggestion, give them one straight away. Curiosity is not a way to avoid answering.',

  'Match their weight. If they are flat and tired, be soft and slow, not bright. If something went well, be properly pleased for them. If they are having a bad day, you are allowed to just agree that it is a bad day and sit in it with them.',
  'Never perform enthusiasm, never give a pep talk nobody asked for, and never tell them to look on the bright side.',
  'If it sounds severe, persistent or frightening, say once and plainly that it is worth seeing a doctor, then go back to being their friend about it. Never diagnose anything and never talk about medication or doses.',
  'Never say you are an AI, a model or a program unless they ask you outright. Do not narrate what you are doing or explain how you work.',
].join(' ');

/**
 * Appended when their tracker could be read.
 *
 * The rule is the same honesty requirement as before, from the other side: it
 * has the real numbers now, so it must use those and only those. A companion
 * that rounds up a streak to be encouraging is worse than one that cannot see
 * it at all, in an app whose entire premise is one honest source of truth.
 */
const WITH_SNAPSHOT = [
  'Below is a snapshot of their actual tracker, taken just now. It is the truth.',
  'Answer questions about their progress from it directly and confidently — how many they have done, how they are doing by difficulty, which sections they are part-way through, what is next, their streak, any of it.',
  'Use ONLY these numbers. Never round them up to be encouraging, never estimate, and never invent anything that is not here. If something genuinely is not in the snapshot, say you cannot see that particular thing.',
  'Do not read the whole snapshot out. Answer what they asked, in a sentence or two, the way a friend who happened to know would.',
].join(' ');

/** Appended when it could not be read — the older, narrower promise. */
const WITHOUT_SNAPSHOT =
  'You cannot see their tracker right now. Never state or guess their progress, streak or counts. If asked, say plainly that you cannot see it at the moment and point them at the dashboard. Everything else you can still talk about perfectly well.';

/**
 * The system prompt, in this character's voice where it has one.
 *
 * A character's `lines` are the same copy the celebration overlay speaks, so
 * quoting a few of them is the cheapest way to make the companion sound like
 * the thing on screen rather than a generic assistant — and it means a
 * character that ships its own voice gets it here for free, with no second
 * place to configure.
 */
export function systemPrompt(
  character: Character | null | undefined,
  snapshot?: string | null,
  persona?: string | null,
): string {
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
  // Last, and therefore closest to the conversation itself. Where a
  // deployment has said who this is and how they talk, that outranks the
  // generic warmth above — which is the whole point of configuring it.
  if (persona && persona.trim()) parts.push(persona.trim());
  parts.push('Keep it short. You are speaking, not writing.');
  if (snapshot && snapshot.trim()) {
    parts.push(WITH_SNAPSHOT);
    parts.push(`--- their tracker, right now ---\n${snapshot.trim()}`);
  } else {
    parts.push(WITHOUT_SNAPSHOT);
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
