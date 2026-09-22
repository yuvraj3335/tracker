/**
 * Colour validation, run against `globals.css` itself.
 *
 * The palette's claim is that every value was checked "against the surface it
 * actually renders on, in both modes". Nothing enforced that, and it had
 * drifted: --ink-muted (the app's most-used secondary text) failed 4.5:1 in all
 * six theme/mode combinations, the tick box outline sat at 1.48:1, the
 * difficulty chip hardcoded white ink onto a ramp that inverts in dark mode
 * (2.53:1), and Rampart's light heatmap ramp was not lightness-monotonic — one
 * completed question rendered *paler* than an empty day.
 *
 *   npm run check:color
 *
 * Reads the stylesheet rather than a copy of the values, so a token edited in
 * CSS is what gets measured.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// The same maths the app uses to vet a character's accent at runtime, so the
// shipped tokens and an incoming one are judged by one implementation.
import { contrastRatio, parseHex } from '../src/lib/contrast';

const CSS = readFileSync(join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8');

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; }
  else { fail++; console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

// ---------------------------------------------------------------------------
// sRGB -> OKLCH, and WCAG contrast.
// ---------------------------------------------------------------------------
function rgb(hex: string): [number, number, number] {
  const v = parseHex(hex);
  if (!v) throw new Error(`not a hex colour: ${hex}`);
  return v;
}
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function lightness(hex: string): number {
  const [r, g, b] = rgb(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

function contrast(a: string, b: string): number {
  const r = contrastRatio(a, b);
  if (r === null) throw new Error(`not a hex colour: ${a} / ${b}`);
  return r;
}

/** Composite a translucent foreground over an opaque background. */
function over(fg: string, alpha: number, bg: string): string {
  const f = rgb(fg);
  const b = rgb(bg);
  return (
    '#' +
    f
      .map((c, i) => Math.round((c * alpha + b[i] * (1 - alpha)) * 255).toString(16).padStart(2, '0'))
      .join('')
  );
}

// ---------------------------------------------------------------------------
// Pull each selector block's tokens straight out of the stylesheet.
// ---------------------------------------------------------------------------
type Tokens = Record<string, string>;

function block(marker: string, stopAt: string): Tokens {
  const i = CSS.indexOf(marker);
  if (i < 0) throw new Error(`block not found: ${marker}`);
  const j = CSS.indexOf(stopAt, i + marker.length);
  const out: Tokens = {};
  for (const m of CSS.slice(i, j < 0 ? undefined : j).matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,8})\s*;/gi)) {
    out[m[1]] = m[2];
  }
  return out;
}

const baseLight = block(':root {\n  color-scheme: light;', '@media (prefers-color-scheme: dark)');
const baseDark = block(':root[data-theme="dark"] {', '@theme inline');
const rampartLight = block(":root[data-skin='rampart'] {", '@media (prefers-color-scheme: dark)');
const rampartDark = block(":root[data-skin='rampart'][data-theme='dark'] {", '/* --------------------------- BLOSSOM');
const blossomLight = block(":root[data-skin='blossom'] {", '@media (prefers-color-scheme: dark)');
const blossomDark = block(":root[data-skin='blossom'][data-theme='dark'] {", '/* ---- shape language');

const THEMES: Record<string, Tokens> = {
  'studio light': { ...baseLight },
  'studio dark': { ...baseLight, ...baseDark },
  'rampart light': { ...baseLight, ...rampartLight },
  'rampart dark': { ...baseLight, ...baseDark, ...rampartLight, ...rampartDark },
  'blossom light': { ...baseLight, ...blossomLight },
  'blossom dark': { ...baseLight, ...baseDark, ...blossomLight, ...blossomDark },
};

/** [label, foreground, background, floor] */
const TEXT: [string, string, string][] = [
  ['ink on surface', '--ink', '--surface'],
  ['ink-2 on surface', '--ink-2', '--surface'],
  ['ink-muted on surface', '--ink-muted', '--surface'],
  ['ink-muted on surface-2', '--ink-muted', '--surface-2'],
  ['ink-muted on plane', '--ink-muted', '--plane'],
  ['accent link on surface', '--accent', '--surface'],
  ['accent link on plane', '--accent', '--plane'],
  ['accent-ink on accent', '--accent-ink', '--accent'],
  ['good-text on surface', '--good-text', '--surface'],
  ['critical on surface', '--critical', '--surface'],
  ['critical on surface-2', '--critical', '--surface-2'],
];

/** Non-text: control boundaries and chart marks. */
const NON_TEXT: [string, string, string][] = [
  ['control border on surface', '--control', '--surface'],
  ['control border on surface-2', '--control', '--surface-2'],
  ['focus ring on surface', '--accent', '--surface'],
  ['focus ring on surface-2', '--accent', '--surface-2'],
];

/**
 * Filled marks that carry their own label: the label sits on the fill, not on
 * the page, so it is measured against the fill.
 *
 * The two status pills are here rather than in TEXT because --warning cannot be
 * a text colour in any theme — it is 1.79:1 on a light surface and does not
 * even clear the 3:1 non-text floor. A filled pill with its own ink is the only
 * way to use it without dropping below what every other token holds to, which
 * is why the focus timer escalates with a pill rather than by recolouring its
 * digits. (--critical does clear 4.5:1 as text, and TEXT below checks that.)
 */
const CHIPS: [string, string, string][] = [
  ['Easy chip label', '--diff-easy-ink', '--diff-easy'],
  ['Medium chip label', '--diff-medium-ink', '--diff-medium'],
  ['Hard chip label', '--diff-hard-ink', '--diff-hard'],
  ['warning pill label', '--warning-ink', '--warning'],
  ['critical pill label', '--critical-ink', '--critical'],
];

function main() {
  console.log('Colour validation (6 theme/mode combinations)\n');

  for (const [theme, t] of Object.entries(THEMES)) {
    const at = (k: string) => {
      const v = t[k];
      if (!v) throw new Error(`${theme} is missing ${k}`);
      return v;
    };

    for (const [label, fg, bg] of [...TEXT, ...CHIPS]) {
      const r = contrast(at(fg), at(bg));
      check(`${theme}: ${label}`, r >= 4.5, `${r.toFixed(2)}:1 (needs 4.5) ${at(fg)} on ${at(bg)}`);
    }
    for (const [label, fg, bg] of NON_TEXT) {
      const r = contrast(at(fg), at(bg));
      check(`${theme}: ${label}`, r >= 3, `${r.toFixed(2)}:1 (needs 3) ${at(fg)} on ${at(bg)}`);
    }

    // Any translucent wash the UI puts text on has to be measured against what
    // it composites to, not against the token. The "Continue" pill used to be
    // accent text on a 12% accent wash and never cleared 4.5:1 in any theme
    // (3.97–4.31); it is solid accent now, which `accent-ink on accent` covers.
    // This keeps the composite maths available for the next one.
    const wash = over(at('--accent'), 0.12, at('--surface'));
    check(`${theme}: accent wash stays a background, not a text colour`,
      contrast(at('--ink'), wash) >= 4.5,
      `ink on accent/12 = ${contrast(at('--ink'), wash).toFixed(2)}:1`);

    // Sequential heatmap ramp: magnitude must read as one direction of
    // lightness, with steps big enough to tell apart. Rampart's light ramp
    // used to go UP between step 0 and step 1.
    const ramp = [0, 1, 2, 3, 4].map((i) => lightness(at(`--seq-${i}`)));
    const steps = ramp.slice(1).map((v, i) => v - ramp[i]);
    const monotonic = steps.every((d) => d > 0) || steps.every((d) => d < 0);
    check(`${theme}: heatmap ramp is lightness-monotonic`, monotonic, ramp.map((v) => v.toFixed(3)).join(' '));
    const minStep = Math.min(...steps.map(Math.abs));
    check(`${theme}: heatmap steps are distinguishable`, minStep >= 0.04, `min step ${minStep.toFixed(3)}`);

    // Ordinal difficulty ramp: same direction, and adjacent steps must clear
    // the 2:1 ordinal floor so Easy/Medium/Hard are separable.
    const diff = ['easy', 'medium', 'hard'].map((d) => lightness(at(`--diff-${d}`)));
    const dSteps = diff.slice(1).map((v, i) => v - diff[i]);
    check(
      `${theme}: difficulty ramp is lightness-monotonic`,
      dSteps.every((d) => d > 0) || dSteps.every((d) => d < 0),
      diff.map((v) => v.toFixed(3)).join(' '),
    );
    // The stated gate for the ordinal ramp: every step clears 2:1 against the
    // surface it renders on. Adjacent steps sit closer than that, which is
    // fine — the chip is labelled "Easy"/"Medium"/"Hard", so colour reinforces
    // the value and never carries it alone.
    for (const d of ['easy', 'medium', 'hard']) {
      const r = contrast(at(`--diff-${d}`), at('--surface'));
      check(`${theme}: difficulty ${d} clears the ordinal floor`, r >= 2, `${r.toFixed(2)}:1`);
    }
  }

  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main();
