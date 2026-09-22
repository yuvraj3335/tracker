/**
 * Character discovery — the filesystem half of the character system.
 *
 * Walks `public/characters/` once per process and returns whatever is actually
 * there. There is deliberately no hardcoded character list anywhere in the
 * source: adding art means dropping a folder in, not editing code.
 *
 * Node-only (`node:fs`), so this must never be imported from a client
 * component. Server components read it and pass the plain-data result down.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  MODEL_FILES,
  POSES,
  POSE_EXTENSIONS,
  parseCharacterMeta,
  type Character,
  type Pose,
} from './characters';

const ROOT = join(process.cwd(), 'public', 'characters');

/** First extension that exists on disk, or null. Keeps us from emitting 404s. */
function findPose(dir: string, id: string, pose: Pose): string | null {
  for (const ext of POSE_EXTENSIONS) {
    const file = `${pose}.${ext}`;
    if (existsSync(join(dir, file))) return `/characters/${id}/${file}`;
  }
  return null;
}

/** The rendered model, if this character ships one instead of pose images. */
function findModel(dir: string, id: string): string | null {
  for (const file of MODEL_FILES) {
    if (existsSync(join(dir, file))) return `/characters/${id}/${file}`;
  }
  return null;
}

function readOne(id: string): Character | null {
  const dir = join(ROOT, id);
  try {
    if (!statSync(dir).isDirectory()) return null;
  } catch {
    return null;
  }

  const metaPath = join(dir, 'meta.json');
  if (!existsSync(metaPath)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch (e) {
    // A malformed file is the owner's to fix, but it must not take the app
    // down — the rest of the catalogue still loads.
    console.warn(`[characters] ${id}/meta.json is not valid JSON:`, (e as Error).message);
    return null;
  }

  const meta = parseCharacterMeta(parsed, id);
  if (!meta) {
    // Two different causes, and saying which one saves a confusing hunt: the
    // folder name is validated too, because it is what the image URLs are
    // built from.
    const badName = !/^[a-z0-9][a-z0-9_-]*$/i.test(id);
    console.warn(
      badName
        ? `[characters] folder "${id}" is not a usable id — start with a letter or digit, then letters, digits, - or _`
        : `[characters] ${id}/meta.json is missing required fields (artist, license)`,
    );
    return null;
  }

  // A model wins outright, so the pose scan is skipped rather than run and
  // ignored. That keeps "the two are not merged" a property of the data
  // instead of a rule the renderer has to remember, and it stops a folder with
  // both shipping pose URLs to the client that nothing will ever read.
  const model = findModel(dir, id);
  if (model) return { ...meta, poses: {}, model };

  const poses: Partial<Record<Pose, string>> = {};
  for (const pose of POSES) {
    const url = findPose(dir, id, pose);
    if (url) poses[pose] = url;
  }

  // Nothing to render either way means the SVG mascot covers it instead.
  if (!poses.idle) {
    console.warn(`[characters] ${id} has neither a model nor an idle image — skipping`);
    return null;
  }

  return { ...meta, poses };
}

let cache: Character[] | null = null;

/**
 * Every installed character, sorted by display name.
 *
 * Cached for the life of the process: this is startup discovery, and the task
 * list re-renders far too often to stat the filesystem on each pass. Adding a
 * character in development needs a dev-server restart, which the README says.
 */
export function discoverCharacters(): Character[] {
  if (cache) return cache;
  let entries: string[] = [];
  try {
    entries = readdirSync(ROOT);
  } catch {
    // No folder at all is the normal zero-asset case, not a problem.
    cache = [];
    return cache;
  }
  const found: Character[] = [];
  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'README.md') continue;
    const c = readOne(entry);
    if (c) found.push(c);
  }
  found.sort((a, b) => a.name.localeCompare(b.name));
  cache = found;
  return cache;
}
