/**
 * Whose voice speaks — the character's, or the skin's.
 *
 * A character may ship its own `lines` in meta.json. When it does, those win,
 * so an installed character sounds like itself rather than like the theme it
 * happens to be sitting in. When it does not, the skin's existing copy is used
 * unchanged, which is also what happens with no character at all.
 *
 * Lines rotate by count rather than shuffling, matching `pickLine` in themes.ts:
 * random selection lands the same line twice in a row often enough to feel
 * broken, and this is the line you see after every single tick.
 */
import { pickLine, type ThemeMeta } from './themes';
import type { Character } from './characters';

export type VoiceKind = 'cheer' | 'milestone' | 'idle';

/** The skin's own copy for a kind, used whenever the character has none. */
function themeLines(theme: ThemeMeta, kind: VoiceKind): string[] {
  if (kind === 'milestone') return theme.milestone;
  if (kind === 'idle') return [theme.tagline];
  return theme.cheers;
}

/**
 * One line for this moment.
 *
 * `n` is the rotation counter (completions so far), so consecutive events step
 * through the list instead of repeating.
 */
export function pickCharacterLine(
  character: Character | null | undefined,
  kind: VoiceKind,
  theme: ThemeMeta,
  n: number,
): string {
  const own = character?.lines?.[kind];
  if (own && own.length) return pickLine(own, n);
  return pickLine(themeLines(theme, kind), n);
}

/**
 * The character's line of the day, or null.
 *
 * Keyed on the date so it is stable for a whole day rather than changing on
 * every render — the dashboard would otherwise reshuffle its greeting each time
 * a checkbox moved. Only characters that ship `lines.idle` say anything; there
 * is no generic filler.
 */
export function dailyLine(
  character: Character | null | undefined,
  dayKey: string,
): string | null {
  const lines = character?.lines?.idle;
  if (!lines || !lines.length) return null;
  // Sum of the date's digits: stable per day, cheap, and spreads adjacent days
  // across different lines.
  let seed = 0;
  for (let i = 0; i < dayKey.length; i++) seed += dayKey.charCodeAt(i) * (i + 1);
  return lines[seed % lines.length];
}
