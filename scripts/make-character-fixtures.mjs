/**
 * Generates placeholder characters into `public/characters/`, so the character
 * pipeline can be exercised without any artwork.
 *
 *   node scripts/make-character-fixtures.mjs        # create
 *   node scripts/make-character-fixtures.mjs clean  # remove
 *
 * This exists because the interesting paths in the character system are the
 * ones you cannot see with an empty folder: pose fallback, a malformed
 * meta.json, an unusable folder name, a per-character accent, character voice
 * lines, and the attribution screen. Verifying those by hand meant inventing
 * art every time.
 *
 * The output is deliberately ugly — flat coloured squares with a letter — so
 * nobody mistakes a fixture for a design, and `public/characters/*` stays
 * ignored by git. Real artwork is the owner's to add; see the README in that
 * folder for what is required and where it goes.
 *
 * No dependencies: the PNGs are written by hand with zlib, which node has.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'characters');

// ---------------------------------------------------------------------------
// Minimal PNG writer (RGBA, no filtering).
// ---------------------------------------------------------------------------
function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * A square with a transparent margin and a letter-ish glyph block, so the
 * figure has real transparent edges — which is what the app's layout assumes.
 */
function png(size, [r, g, b], glyphRows) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const margin = Math.round(size * 0.12);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 4;
      const inside = x >= margin && x < size - margin && y >= margin && y < size - margin;
      // A blocky glyph in the middle third, so the four poses look different.
      const gx = Math.floor(((x - margin) / (size - margin * 2)) * 5);
      const gy = Math.floor(((y - margin) / (size - margin * 2)) * 5);
      const lit = inside && glyphRows[gy]?.[gx] === '#';
      raw[i] = lit ? 255 : r;
      raw[i + 1] = lit ? 255 : g;
      raw[i + 2] = lit ? 255 : b;
      raw[i + 3] = inside ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const GLYPH = {
  idle: ['.###.', '#...#', '#...#', '#...#', '.###.'],
  celebrate: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  milestone: ['..#..', '.###.', '#####', '.###.', '..#..'],
  sad: ['.....', '#...#', '.....', '.###.', '#...#'],
};

/**
 * Four fixtures, each covering a case the empty folder cannot reach.
 */
const FIXTURES = [
  {
    id: 'fixture-full',
    colour: [124, 77, 204],
    poses: ['idle', 'celebrate', 'milestone', 'sad'],
    meta: {
      name: 'Fixture Full',
      artist: 'Placeholder generator',
      source: 'https://example.invalid/fixtures',
      license: 'Placeholder — not artwork, generated locally for testing',
      accent: '#7c4dcc',
      lines: {
        cheer: ['Fixture cheer one.', 'Fixture cheer two.'],
        milestone: ['Fixture milestone.'],
        idle: ['Fixture idle line.'],
      },
    },
  },
  {
    // Only idle: every other pose must resolve through the fallback chain and
    // must never request a file that is not there.
    id: 'fixture-idle-only',
    colour: [15, 122, 107],
    poses: ['idle'],
    meta: {
      name: 'Fixture Idle Only',
      artist: 'Placeholder generator',
      source: '',
      license: 'Placeholder — not artwork, generated locally for testing',
    },
  },
  {
    // Valid JSON, missing the attribution fields: must be refused, because a
    // character shown without a credit is the failure this system exists to
    // avoid.
    id: 'fixture-no-credit',
    colour: [200, 80, 80],
    poses: ['idle'],
    meta: { name: 'Fixture No Credit' },
  },
  {
    // Complete meta, no image at all: nothing to render, so it is skipped.
    id: 'fixture-no-art',
    colour: [0, 0, 0],
    poses: [],
    meta: {
      name: 'Fixture No Art',
      artist: 'Placeholder generator',
      license: 'Placeholder',
    },
  },
];

/** Written as raw text so it is genuinely malformed, not just wrong-shaped. */
const MALFORMED = 'fixture-malformed';
/** Not a usable URL segment, so discovery must refuse it by name. */
const BAD_NAME = 'fixture bad name';

function clean() {
  for (const { id } of FIXTURES) rmSync(join(ROOT, id), { recursive: true, force: true });
  rmSync(join(ROOT, MALFORMED), { recursive: true, force: true });
  rmSync(join(ROOT, BAD_NAME), { recursive: true, force: true });
  console.log('Removed character fixtures.');
}

function create() {
  for (const f of FIXTURES) {
    const dir = join(ROOT, f.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(f.meta, null, 2) + '\n');
    for (const pose of f.poses) {
      writeFileSync(join(dir, `${pose}.png`), png(512, f.colour, GLYPH[pose]));
    }
    console.log(`  ${f.id}: ${f.poses.length} pose(s)`);
  }

  const bad = join(ROOT, MALFORMED);
  mkdirSync(bad, { recursive: true });
  writeFileSync(join(bad, 'meta.json'), '{ this is not json ');
  writeFileSync(join(bad, 'idle.png'), png(512, [90, 90, 90], GLYPH.idle));
  console.log(`  ${MALFORMED}: malformed meta.json`);

  const unsafe = join(ROOT, BAD_NAME);
  mkdirSync(unsafe, { recursive: true });
  writeFileSync(
    join(unsafe, 'meta.json'),
    JSON.stringify({ name: 'Bad Name', artist: 'x', license: 'y' }, null, 2) + '\n',
  );
  writeFileSync(join(unsafe, 'idle.png'), png(512, [90, 90, 90], GLYPH.idle));
  console.log(`  "${BAD_NAME}": folder name is not a usable URL segment`);

  console.log('\nRestart the dev server — discovery is cached for the process.');
  console.log('Expect 2 characters installed, and 4 skipped with a reason on the server console.');
}

if (!existsSync(ROOT)) mkdirSync(ROOT, { recursive: true });
if (process.argv[2] === 'clean') clean();
else create();
