/**
 * Who the companion is, kept out of the source.
 *
 * The character in `characters.ts` is the figure on screen — its name, its
 * artwork, the handful of lines it says when something goes well. This is the
 * other half: who it is *to the person talking to it*, and how that person
 * likes to be spoken to. That half is personal, and this repository is public,
 * so none of it is written down here.
 *
 * Everything comes from the environment. With nothing set, the companion is
 * exactly what a fresh checkout gets — warm, general, nobody in particular —
 * which is also what anyone reading this file can see. Setting these on a
 * deployment makes it somebody's, without that somebody's name, habits or pet
 * names ever reaching a commit.
 *
 *   COMPANION_PERSON   who it is talking to, and anything worth knowing
 *   COMPANION_STYLE    how to talk: rhythm, vocabulary, the verbal tics
 *   COMPANION_OPENERS  a few lines it might actually open with
 *
 * Read on the server only. None of it is ever sent to the browser — the
 * browser gets the reply, and the reply is all it gets.
 */

/** Trimmed, length-capped, and empty rather than undefined. */
function read(name: string, limit: number): string {
  const value = process.env[name]?.trim() ?? '';
  return value.slice(0, limit);
}

export type Persona = {
  /** Who is on the other end, in whatever detail was configured. */
  person: string;
  /** How to sound. The part that makes it a particular person rather than an assistant. */
  style: string;
  /** Openers to draw on, so it does not begin the same way every time. */
  openers: string[];
};

/**
 * Caps, because this is prepended to every request.
 *
 * Generous enough for a real description of somebody and how they talk,
 * small enough that a runaway value cannot quietly triple the bill on every
 * single message.
 */
export const MAX_PERSON = 2_000;
export const MAX_STYLE = 2_000;
export const MAX_OPENERS = 600;

export function getPersona(): Persona {
  return {
    person: read('COMPANION_PERSON', MAX_PERSON),
    style: read('COMPANION_STYLE', MAX_STYLE),
    openers: read('COMPANION_OPENERS', MAX_OPENERS)
      .split('|')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8),
  };
}

/** True when a deployment has actually configured one. */
export const hasPersona = (persona: Persona): boolean =>
  Boolean(persona.person || persona.style || persona.openers.length);

/**
 * The persona as instructions, or nothing at all.
 *
 * Pure and taking the persona rather than reading the environment itself, so
 * what it produces can be tested without setting variables on the machine
 * running the tests.
 */
export function personaPrompt(persona: Persona): string {
  if (!hasPersona(persona)) return '';
  const parts: string[] = [];
  if (persona.person) {
    parts.push(`Who you are talking to: ${persona.person}`);
  }
  if (persona.style) {
    parts.push(
      `How you talk. This matters more than anything else here — it is the difference between you and any other assistant, so follow it closely even when the subject is serious: ${persona.style}`,
    );
  }
  if (persona.openers.length) {
    parts.push(
      `Lines you might open with, for the feel of them rather than to be repeated verbatim: ${persona.openers.join(' / ')}`,
    );
  }
  return parts.join('\n\n');
}
