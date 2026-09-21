'use client';

/**
 * A tiny pub/sub for celebrations.
 *
 * Any task row can fire one from anywhere in the tree, and a single overlay
 * mounted in the layout renders it. An event bus rather than context because
 * the rows and the overlay are siblings, not ancestor and descendant, and
 * prop-drilling a trigger through four page layouts would be worse.
 */
export type CelebrationKind = 'cheer' | 'milestone' | 'streak';

export type Celebration = {
  kind: CelebrationKind;
  message: string;
  /** Monotonic, so the overlay can re-run its animation on repeat events. */
  id: number;
};

type Listener = (c: Celebration) => void;

const listeners = new Set<Listener>();
let counter = 0;

/** How many completions this tab has seen — used to rotate the cheer lines. */
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

export function celebrate(kind: CelebrationKind, message: string) {
  const event: Celebration = { kind, message, id: ++counter };
  listeners.forEach((l) => l(event));
}
