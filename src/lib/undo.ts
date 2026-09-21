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
  /**
   * What happened. `undo` is the ordinary confirmation-with-a-way-back;
   * `problem` is a write that did not land, which has to look different and be
   * announced assertively rather than politely.
   */
  tone: 'undo' | 'problem';
  /** Button text. Absent when there is nothing useful to offer. */
  actionLabel?: string;
  /** Runs the action. Awaited so the toast can show a pending state. */
  run?: () => Promise<void> | void;
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

function emit(offer: UndoOffer) {
  listeners.forEach((l) => l(offer));
}

export function offerUndo(label: string, run: NonNullable<UndoOffer['run']>) {
  emit({ id: ++counter, label, tone: 'undo', actionLabel: 'Undo', run });
}

/**
 * A write did not land, and the person needs to know the thing they just did
 * did not happen.
 *
 * Writing to Notion is the app's single input and Notion rate-limits, so this
 * is a normal Tuesday rather than an exceptional path. It previously had no
 * handling at all: the rejected action reached the route error boundary and
 * replaced the whole 456-row sheet with "That did not load", losing scroll
 * position, open sections, the search and the filter — because one checkbox
 * failed. The optimistic tick reverts on its own; this says why.
 */
export function reportProblem(label: string, retry?: NonNullable<UndoOffer['run']>) {
  emit({
    id: ++counter,
    label,
    tone: 'problem',
    ...(retry ? { actionLabel: 'Try again', run: retry } : {}),
  });
}

/** Withdraws the current offer — used once it has been taken or has expired. */
export function clearUndo() {
  listeners.forEach((l) => l(null));
}
