/**
 * Character system — types and pure resolution logic.
 *
 * A "character" is art the *owner* supplies by dropping a folder into
 * `public/characters/`. Nothing here ships artwork, and nothing here reaches
 * the network: discovery reads the filesystem once at startup (see
 * `characters.server.ts`) and hands the result to the client as plain data.
 *
 * The whole system is optional by construction. With zero folders installed
 * the catalogue is empty, `resolveCharacter` answers null, and every surface
 * falls back to the original SVG mascots in `mascot.tsx`. That fallback is the
 * default path, not an error path — it is what the app looks like out of the
 * box.
 *
 * Everything in this file is pure so it can be unit-tested without a
 * filesystem; the fs walk lives in `characters.server.ts`.
 */

/** The poses. Only `idle` is mandatory; the rest resolve by fallback. */
export const POSES = ['idle', 'celebrate', 'milestone', 'sad', 'concerned', 'focused'] as const;
export type Pose = (typeof POSES)[number];

/** Image extensions accepted for a pose, in preference order. */
export const POSE_EXTENSIONS = ['webp', 'avif', 'png', 'jpg', 'jpeg'] as const;

export type CharacterLines = {
  cheer?: string[];
  milestone?: string[];
  idle?: string[];
};

export type Character = {
  id: string;
  name: string;
  artist: string;
  source: string;
  license: string;
  /** Optional accent override, applied as --accent while this character is active. */
  accent?: string;
  lines?: CharacterLines;
  /** Public URLs for each pose that actually exists on disk. */
  poses: Partial<Record<Pose, string>>;
};

/**
 * Pose fallback chain.
 *
 * Two of these degrade in two steps rather than dropping straight to `idle`,
 * because the intermediate pose still carries the right feeling:
 *
 *   milestone  a character with no milestone art should still look celebratory
 *              rather than resting in the middle of a celebration.
 *   concerned  the softer "things have gone quiet" pose. With no art of its
 *              own, `sad` is far closer to it than a neutral idle is.
 *
 * `focused` drops straight to `idle` deliberately: nothing else in the set
 * reads as quiet concentration, and a celebratory or sad stand-in would say
 * the wrong thing for the whole length of a focus session.
 */
const FALLBACK: Record<Pose, Pose[]> = {
  idle: ['idle'],
  celebrate: ['celebrate', 'idle'],
  milestone: ['milestone', 'celebrate', 'idle'],
  sad: ['sad', 'idle'],
  concerned: ['concerned', 'sad', 'idle'],
  focused: ['focused', 'idle'],
};

/**
 * The URL to render for a pose, walking the fallback chain.
 *
 * Returns null when the character is missing or has no usable art at all, which
 * is the caller's signal to draw the SVG mascot instead. It never returns a
 * path that discovery did not confirm on disk, so this cannot produce a 404.
 */
export function resolvePose(character: Character | null | undefined, pose: Pose): string | null {
  if (!character) return null;
  for (const candidate of FALLBACK[pose] ?? [pose]) {
    const url = character.poses[candidate];
    if (url) return url;
  }
  return null;
}

/** True when a character has at least an idle pose — i.e. is renderable. */
export function isRenderable(character: Character | null | undefined): boolean {
  return Boolean(character && character.poses.idle);
}

/** Looks a character up by id. Unknown ids answer null rather than throwing. */
export function resolveCharacter(
  catalog: readonly Character[],
  id: string | null | undefined,
): Character | null {
  if (!id) return null;
  return catalog.find((c) => c.id === id) ?? null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Keeps only non-empty strings, so a half-filled `lines` block cannot render blanks. */
function stringList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return out.length ? out : undefined;
}

function parseLines(v: unknown): CharacterLines | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const raw = v as Record<string, unknown>;
  const lines: CharacterLines = {};
  const cheer = stringList(raw.cheer);
  const milestone = stringList(raw.milestone);
  const idle = stringList(raw.idle);
  if (cheer) lines.cheer = cheer;
  if (milestone) lines.milestone = milestone;
  if (idle) lines.idle = idle;
  return Object.keys(lines).length ? lines : undefined;
}

/** Only `#rgb` / `#rrggbb` is accepted, so a bad value cannot break the palette. */
export function parseAccent(v: unknown): string | undefined {
  const s = str(v);
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? s : undefined;
}

/**
 * Validates one `meta.json`.
 *
 * The folder name wins over any `id` inside the file: the folder is what the
 * URLs are built from, so trusting the file would let a typo point poses at a
 * directory that does not exist. Attribution fields are required in substance —
 * a character with no artist or licence recorded is refused rather than shown
 * with a blank credit, because the attribution surface is the point.
 */
export function parseCharacterMeta(
  raw: unknown,
  folderId: string,
): Omit<Character, 'poses'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;

  const id = str(folderId);
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) return null;

  const name = str(m.name) || id;
  const artist = str(m.artist);
  const source = str(m.source);
  const license = str(m.license);
  if (!artist || !license) return null;

  const meta: Omit<Character, 'poses'> = { id, name, artist, source, license };
  const accent = parseAccent(m.accent);
  if (accent) meta.accent = accent;
  const lines = parseLines(m.lines);
  if (lines) meta.lines = lines;
  return meta;
}
