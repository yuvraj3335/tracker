'use client';

/**
 * A one-slot undo offer for the last toggle.
 *
 * Ticking 456 things by hand means mis-taps, and the only correction available
 * before this was to find the row again and tick it back — which on a filtered
 * "to do" view means the row has already vanished from the list.
 *
 * One slot, not a stack: a second action supersedes the first rather than
 * queueing. Undo here means "that last tap was wrong", and offering to walk
 * backwards through a history nobody is tracking would promise more than it
 * delivers.
 *
 * Same pub/sub shape as celebrate.ts, for the same reason — the thing that
 * fires and the thing that renders are siblings in the tree.
 */
export type UndoOffer = {
  id: number;
  /** Shown in the toast, e.g. 'Marked "Two Sum" done'. */
  label: string;
  /** Reverses it. Awaited so the toast can show a pending state. */
  run: () => Promise<void> | void;
};

type Listener = (o: UndoOffer | null) => void;

const listeners = new Set<Listener>();
let counter = 0;

export function onUndoOffer(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function offerUndo(label: string, run: UndoOffer['run']) {
  const offer: UndoOffer = { id: ++counter, label, run };
  listeners.forEach((l) => l(offer));
}

/** Withdraws the current offer — used once it has been taken or has expired. */
export function clearUndo() {
  listeners.forEach((l) => l(null));
}
