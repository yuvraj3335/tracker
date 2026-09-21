/**
 * Colour maths, shared by the runtime and by `npm run check:color`.
 *
 * It lives in src/ rather than in the script because a character's accent comes
 * from a `meta.json` the owner wrote, and an arbitrary hex cannot be trusted to
 * clear the floors the palette guarantees. The same function that validates the
 * shipped tokens therefore has to be available at runtime to vet an incoming
 * one — otherwise a character could quietly undo the contrast work.
 *
 * Pure and dependency-free, so it is testable without a DOM.
 */

/** #rgb or #rrggbb -> [r,g,b] in 0..1. Returns null for anything else. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** WCAG relative luminance. */
export function luminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1..21. Returns null if either colour is unparseable. */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Black or white, whichever reads better on `background`. */
export function readableInk(background: string): '#0b0b0b' | '#ffffff' {
  const onDark = contrastRatio('#ffffff', background) ?? 0;
  const onLight = contrastRatio('#0b0b0b', background) ?? 0;
  return onLight >= onDark ? '#0b0b0b' : '#ffffff';
}

/**
 * Whether a character's accent may replace the theme's.
 *
 * The accent is used as link text, as a button fill carrying its own ink, and
 * as the focus ring — so it has to clear 4.5:1 as text on both surfaces it
 * renders on, and its ink has to clear 4.5:1 on the accent itself. A character
 * whose colour cannot do that keeps the theme's accent rather than quietly
 * dropping the palette below the floor the rest of the app holds.
 */
export function usableAccent(
  accent: string | undefined,
  /** Surfaces the accent renders as TEXT on — the 4.5:1 floor. */
  textSurfaces: readonly string[],
  /** Surfaces it only draws on (the focus ring) — the 3:1 floor. */
  markSurfaces: readonly string[] = [],
): { accent: string; ink: string } | null {
  if (!accent || parseHex(accent) === null) return null;
  // Exactly the gates `npm run check:color` holds the shipped accents to, so a
  // character cannot be admitted on easier terms than the theme it replaces.
  for (const bg of textSurfaces) {
    const r = contrastRatio(accent, bg);
    if (r === null || r < 4.5) return null;
  }
  for (const bg of markSurfaces) {
    const r = contrastRatio(accent, bg);
    if (r === null || r < 3) return null;
  }
  const ink = readableInk(accent);
  const inkRatio = contrastRatio(ink, accent);
  if (inkRatio === null || inkRatio < 4.5) return null;
  return { accent, ink };
}
