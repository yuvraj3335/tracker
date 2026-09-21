'use client';

/**
 * Independent appearance axes, all per-viewer preferences:
 *
 *   mode      — system | light | dark      -> data-theme on <html>
 *   skin      — studio | rampart | blossom -> data-skin on <html>
 *   character — an installed character id, or '' for the built-in SVG mascot
 *
 * Held in localStorage and read through useSyncExternalStore rather than
 * mirrored into state by an effect. localStorage can throw in a private window,
 * so every access is guarded; a failure just falls back to the defaults.
 *
 * The inline script in the root layout applies the attributes before first
 * paint, so there is no flash and nothing to synchronise on mount. Character is
 * not applied pre-paint because it is not a palette — it only selects which
 * image a figure renders, and that is decided during render anyway.
 */
import { DEFAULT_SKIN, isSkin, type Skin } from './themes';

export type Mode = 'system' | 'light' | 'dark';
export const MODE_KEY = 'jst-theme';
export const SKIN_KEY = 'jst-skin';
export const CHARACTER_KEY = 'jst-character';

const listeners = new Set<() => void>();
function announce() {
  listeners.forEach((l) => l());
}
export function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

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
    /* ignore — the attribute is still applied for this session */
  }
}

// ----------------------------------------------------------------- mode
let cachedMode: Mode | null = null;

export function getMode(): Mode {
  if (cachedMode) return cachedMode;
  const saved = read(MODE_KEY);
  cachedMode = saved === 'light' || saved === 'dark' ? saved : 'system';
  return cachedMode;
}

export function setMode(mode: Mode) {
  cachedMode = mode;
  write(MODE_KEY, mode);
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  announce();
}

/** The server has no localStorage; these are the correct pre-hydration answers. */
export const serverMode = (): Mode => 'system';

// ----------------------------------------------------------------- skin
let cachedSkin: Skin | null = null;

export function getSkin(): Skin {
  if (cachedSkin) return cachedSkin;
  const saved = read(SKIN_KEY);
  cachedSkin = isSkin(saved) ? saved : DEFAULT_SKIN;
  return cachedSkin;
}

export function setSkin(skin: Skin) {
  cachedSkin = skin;
  write(SKIN_KEY, skin);
  const root = document.documentElement;
  if (skin === DEFAULT_SKIN) root.removeAttribute('data-skin');
  else root.setAttribute('data-skin', skin);
  announce();
}

export const serverSkin = (): Skin => DEFAULT_SKIN;

// ------------------------------------------------------------ character
/**
 * Which installed character to draw. Empty string means "none chosen", which is
 * also the only correct pre-hydration answer: the server cannot know what this
 * device picked, and guessing would flash the wrong art.
 */
let cachedCharacter: string | null = null;

export function getCharacter(): string {
  if (cachedCharacter !== null) return cachedCharacter;
  cachedCharacter = read(CHARACTER_KEY) ?? '';
  return cachedCharacter;
}

export function setCharacter(id: string) {
  cachedCharacter = id;
  write(CHARACTER_KEY, id);
  announce();
}

export const serverCharacter = (): string => '';

// ------------------------------------------------------------- density
/**
 * Row density for the sheet. 456 rows is a lot of scrolling, and how much
 * breathing room each one wants is genuinely a matter of taste rather than
 * something to decide for everyone.
 */
export type Density = 'comfortable' | 'compact';
export const DENSITY_KEY = 'jst-density';

let cachedDensity: Density | null = null;

export function getDensity(): Density {
  if (cachedDensity) return cachedDensity;
  cachedDensity = read(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
  return cachedDensity;
}

export function setDensity(d: Density) {
  cachedDensity = d;
  write(DENSITY_KEY, d);
  announce();
}

export const serverDensity = (): Density => 'comfortable';

// ------------------------------------------------------------- effects
/**
 * Sound and haptics on a tick. One preference for both, because they are the
 * same idea in two channels, and OFF by default — an app that makes noise the
 * first time you touch it reads as broken.
 */
export const EFFECTS_KEY = 'jst-effects';

let cachedEffects: boolean | null = null;

export function getEffects(): boolean {
  if (cachedEffects !== null) return cachedEffects;
  cachedEffects = read(EFFECTS_KEY) === 'on';
  return cachedEffects;
}

export function setEffects(on: boolean) {
  cachedEffects = on;
  write(EFFECTS_KEY, on ? 'on' : 'off');
  announce();
}

export const serverEffects = (): boolean => false;
