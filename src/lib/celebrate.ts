'use client';

/**
 * A tiny pub/sub for celebrations.
 *
 * Any task row can fire one from anywhere in the tree, and a single overlay
 * mounted in the layout renders it. An event bus rather than context because
 * the rows and the overlay are siblings, not ancestor and descendant, and
 * prop-drilling a trigger through four page layouts would be worse.
 *
 * Callers deliberately do NOT pass a message. Resolving the line needs the
 * active skin and the active character, and a task row asking for either would
 * mean 456 subscriptions to the appearance store on the sheet. The overlay is a
 * single component, so it reads them once and picks the line itself; the row
 * just says what happened and how far along it is.
 */
/**
 * Escalating tiers. Each one is a strictly bigger moment than the last, and the
 * overlay scales the figure, the sparks and the ring to match — so finishing a
 * whole section does not land with the same weight as ticking one question.
 *
 * `undo` is not a tier. It is the one thing on this bus that goes backwards —
 * a completion taken back — and it is deliberately the quietest thing here:
 * no sparks, no ring, no sound, and a line that does not scold.
 */
export type CelebrationKind = 'cheer' | 'milestone' | 'section' | 'area' | 'undo';

export type Celebration = {
  kind: CelebrationKind;
  /** Monotonic, so the overlay can re-run its animation on repeat events. */
  id: number;
  /** Rotation counter, so consecutive lines differ rather than repeating. */
  rotate: number;
  /** Set only when a caller wants specific copy (the pickers preview a line). */
  message?: string;
};

type Listener = (c: Celebration) => void;

const listeners = new Set<Listener>();
let counter = 0;

/** How many completions this tab has seen — used to rotate the lines. */
let completions = 0;
export function bumpCompletions(): number {
  return ++completions;
}

export function onCelebrate(listener: Listener) {
  listeners.add(listener);
  // Explicit block: Set.delete returns a boolean, which is not a valid
  // useEffect cleanup return value.
  return () => {
    listeners.delete(listener);
  };
}

export function celebrate(kind: CelebrationKind, message?: string) {
  const event: Celebration = {
    kind,
    id: ++counter,
    rotate: bumpCompletions(),
    ...(message ? { message } : {}),
  };
  listeners.forEach((l) => l(event));
}
