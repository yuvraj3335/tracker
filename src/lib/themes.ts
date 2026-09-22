/**
 * Themes ("skins") are a second axis alongside light/dark.
 *
 *   data-skin="rampart"  ×  data-theme="dark"
 *
 * A skin swaps surfaces, ink, accent, the heatmap ramp and the difficulty ramp;
 * light/dark still picks which set of steps to use. Every colour pair was run
 * through the data-viz validator against the surface it actually renders on, in
 * both modes — see README.
 *
 * The mascots and their voices are original work. They evoke a genre (stark
 * military vs soft and sparkly) rather than copying any studio's characters,
 * which also keeps this safe to deploy publicly.
 */
export const SKINS = ['studio', 'rampart', 'blossom'] as const;
export type Skin = (typeof SKINS)[number];
export const DEFAULT_SKIN: Skin = 'studio';

export type MascotId = 'none' | 'scout' | 'sprite';

export type ThemeMeta = {
  id: Skin;
  name: string;
  tagline: string;
  mascot: MascotId;
  /** Swatches for the theme picker: [surface, accent, ramp-mid]. */
  swatch: [string, string, string];
  /** Shown on a single completion. Picked in rotation, not at random, so it
   *  never repeats the same line twice running. */
  cheers: string[];
  /** Shown when a heading is finished. */
  milestone: string[];
  /** Shown when a whole section is finished — a bigger moment than a heading. */
  sectionDone: string[];
  /** Shown when every question in an area is done. The rarest line in the app. */
  finale: string[];
  /** Shown when a completion is taken back. Never scolding — it just notices. */
  undo: string[];
  /** Said out loud while a reply is being worked out, instead of a spinner.
   *  Short — it only has to cover about a second. */
  /** Shown when a streak ticks over. */
  streak: (days: number) => string;
};

export const THEMES: Record<Skin, ThemeMeta> = {
  studio: {
    id: 'studio',
    name: 'Studio',
    tagline: 'Clean and quiet. Nothing in the way.',
    mascot: 'none',
    swatch: ['#fcfcfb', '#2a78d6', '#6da7ec'],
    cheers: ['Done.', 'Logged.', 'Next.', 'Counted.'],
    milestone: ['Heading complete.', 'That block is finished.'],
    sectionDone: ['Section complete.', 'Whole section done.'],
    finale: ['Every question. Done.'],
    undo: ['Put back.', 'Cleared.'],
    streak: (d) => `${d}-day streak.`,
  },

  rampart: {
    id: 'rampart',
    name: 'Rampart',
    tagline: 'Hold the wall. One problem at a time.',
    mascot: 'scout',
    swatch: ['#1c2124', '#14a08c', '#4fb3a1'],
    cheers: [
      'Advance.',
      'Ground taken.',
      'One less standing.',
      'The line holds.',
      'Formation holding.',
      'Push forward.',
    ],
    milestone: ['Sector cleared.', 'The wall holds. Sector secure.', 'Position taken.'],
    sectionDone: ['Front secured.', 'The whole line is yours.'],
    finale: ['Campaign complete. Stand down.'],
    undo: ['Ground given up.', 'Position released.'],
    streak: (d) => `${d} days on the wall.`,
  },

  blossom: {
    id: 'blossom',
    name: 'Blossom',
    tagline: 'Soft, sparkly, and quietly relentless.',
    mascot: 'sprite',
    swatch: ['#fffdfe', '#7c4dcc', '#9d7ee0'],
    cheers: [
      'Yay! ✨',
      'So good!',
      'Nice one!',
      'Sparkles for you ✨',
      'You did it!',
      'Amazing!',
      'Keep going! 💫',
    ],
    milestone: ['Whole heading done! ✨', 'That is a full set — wow!', 'Every single one! 🌸'],
    sectionDone: ['A whole section! 🌸✨', 'Look at you go — section cleared!'],
    finale: ['Every. Single. Question. 🌸✨'],
    undo: ['Oh! Taken back.', 'That is okay.'],
    streak: (d) => `${d} days in a row! ✨`,
  },
};

export function isSkin(v: unknown): v is Skin {
  return typeof v === 'string' && (SKINS as readonly string[]).includes(v);
}

/** Rotates through a theme's lines by count, so consecutive ticks differ. */
export function pickLine(lines: string[], n: number): string {
  if (!lines.length) return '';
  return lines[Math.abs(n) % lines.length];
}
