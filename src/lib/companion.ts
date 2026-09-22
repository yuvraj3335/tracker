'use client';

/**
 * The floating companion: where it sits, and how it reacts to being poked.
 *
 * The maths is pure and lives at the top so it can be tested without a DOM —
 * clamping in particular, because the failure it prevents is the worst one
 * this feature has: a stored position from a wider window putting the
 * character off-screen where it cannot be picked up, dismissed, or reached at
 * all. Everything below `--- store ---` is the same localStorage pattern the
 * rest of appearance.ts uses.
 */
import { subscribe as subscribeAppearance, announce } from './appearance';

export type Point = { x: number; y: number };

/** Space the companion must keep clear of the app's own fixed chrome. */
export type Safe = { top: number; right: number; bottom: number; left: number };

/** How far an arrow key moves it, and how far Shift+arrow does. */
export const NUDGE = 16;
export const NUDGE_FAR = 64;

/** A pointer that moved less than this between down and up was a tap. */
export const TAP_SLOP = 6;
/** Two taps closer together than this are a double-tap. */
export const DOUBLE_TAP_MS = 320;

/**
 * Poking thresholds.
 *
 * Four pokes inside four seconds is unmistakably someone jabbing at it rather
 * than using it, which is the only reading under which "it gets annoyed" is
 * funny instead of hostile. Below that it just laughs.
 */
export const ANGRY_POKES = 4;
export const ANGRY_WINDOW_MS = 4000;

/**
 * Keeps the companion inside the viewport and clear of the fixed chrome.
 *
 * Also the repair path for a corrupted or stale stored position: a value from
 * a 2560px window, or from before a phone was rotated, resolves to somewhere
 * reachable rather than somewhere off the edge. Non-finite input is treated as
 * no input at all, so a hand-edited localStorage entry cannot strand it.
 */
export function clampToViewport(
  point: Point,
  size: number,
  viewport: { width: number; height: number },
  safe: Safe,
): Point {
  const minX = safe.left;
  const minY = safe.top;
  const maxX = viewport.width - size - safe.right;
  const maxY = viewport.height - size - safe.bottom;
  const axis = (value: number, min: number, max: number) => {
    if (!Number.isFinite(value)) return min;
    // A viewport too small to satisfy both margins pins to the near edge
    // rather than producing a max below the min and inverting the clamp.
    if (max < min) return min;
    return Math.min(max, Math.max(min, value));
  };
  return { x: axis(point.x, minX, maxX), y: axis(point.y, minY, maxY) };
}

/** Bottom-right, above whatever chrome is there. Where it starts, and where "reset" puts it. */
export function defaultPosition(
  size: number,
  viewport: { width: number; height: number },
  safe: Safe,
): Point {
  return clampToViewport(
    { x: viewport.width - size - safe.right, y: viewport.height - size - safe.bottom },
    size,
    viewport,
    safe,
  );
}

/** Reads a stored position. Anything that is not two finite numbers is no position. */
export function parsePosition(raw: string | null): Point | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object') return null;
    const { x, y } = value as Record<string, unknown>;
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  } catch {
    return null;
  }
}

/**
 * What a poke should do, given the pokes before it.
 *
 * `history` is every poke time including this one. Kept as a pure function
 * because the interesting part is the boundary — the fourth poke inside the
 * window is angry, the fourth just outside it is not — and that is far easier
 * to pin down here than by tapping a figure four times in a test browser.
 */
export function pokeReaction(history: readonly number[], now: number): 'laughing' | 'angry' {
  const recent = history.filter((t) => now - t < ANGRY_WINDOW_MS);
  return recent.length >= ANGRY_POKES ? 'angry' : 'laughing';
}

/** Drops pokes that have aged out, so the history cannot grow without bound. */
export function trimPokes(history: readonly number[], now: number): number[] {
  return history.filter((t) => now - t < ANGRY_WINDOW_MS);
}

// --------------------------------------------------------------- store
/**
 * Position and dismissal, per device, through the same guarded localStorage
 * access appearance.ts uses — it throws in a private window, and a companion
 * that cannot remember where it was put is still a working companion.
 */
export const COMPANION_POSITION_KEY = 'jst-companion-pos';
export const COMPANION_DISMISSED_KEY = 'jst-companion-off';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore — it still works for this session */
  }
}

let cachedPosition: Point | null | undefined;

export function getCompanionPosition(): Point | null {
  if (cachedPosition === undefined) cachedPosition = parsePosition(read(COMPANION_POSITION_KEY));
  return cachedPosition;
}

export function setCompanionPosition(point: Point) {
  cachedPosition = point;
  write(COMPANION_POSITION_KEY, JSON.stringify(point));
  announce();
}

/** Forgets the stored spot, so the next render falls back to the default corner. */
export function resetCompanionPosition() {
  cachedPosition = null;
  try {
    localStorage.removeItem(COMPANION_POSITION_KEY);
  } catch {
    /* ignore */
  }
  announce();
}

let cachedDismissed: boolean | undefined;

export function getCompanionDismissed(): boolean {
  if (cachedDismissed === undefined) cachedDismissed = read(COMPANION_DISMISSED_KEY) === 'yes';
  return cachedDismissed;
}

export function setCompanionDismissed(dismissed: boolean) {
  cachedDismissed = dismissed;
  write(COMPANION_DISMISSED_KEY, dismissed ? 'yes' : 'no');
  announce();
}

/** The server knows neither, and these are the answers that render nothing. */
export const serverCompanionPosition = (): Point | null => null;
export const serverCompanionDismissed = (): boolean => true;

export { subscribeAppearance as subscribeCompanion };
