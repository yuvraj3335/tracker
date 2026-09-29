import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge, told about this app's own type scale.
 *
 * Out of the box it does not know `text-micro`, `text-meta` or `text-display`
 * are font sizes, files them as colours, and so `cn('text-micro', 'text-ink-2')`
 * silently dropped the size — every label that combined a custom size with a
 * colour through `cn` (the phone nav, badges, chips) rendered at the inherited
 * size instead. Registering the scale makes them merge as sizes.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['micro', 'meta', 'display'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function pct(done: number, total: number) {
  if (!total) return 0;
  return Math.round((done / total) * 1000) / 10;
}

/** A whole number from loose input, kept within bounds; `fallback` when it is not a number. */
export function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
