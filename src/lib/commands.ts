'use client';

/**
 * A registry the command palette reads from.
 *
 * The palette lives in the root layout so Cmd-K works everywhere, but the most
 * useful commands are page-specific — only the sheet knows what the 18 sections
 * are called. Rather than hoisting that data into the layout (which would mean
 * loading it on every route), a page publishes its commands while mounted and
 * withdraws them on unmount.
 *
 * Publishing returns its own unsubscribe, so the caller can hand it straight
 * back from a useEffect.
 */
export type Command = {
  id: string;
  label: string;
  /** Section header in the palette, e.g. 'Jump to section'. */
  group: string;
  /** Right-aligned hint, e.g. a shortcut or the current value. */
  hint?: string;
  run: () => void;
};

type Listener = () => void;

const scopes = new Map<number, Command[]>();
const listeners = new Set<Listener>();
let nextScope = 0;

/**
 * Snapshot cache.
 *
 * useSyncExternalStore calls getSnapshot on every render and bails only if the
 * result is referentially equal, so returning a fresh array each time is an
 * infinite render loop. The snapshot is rebuilt only when a scope actually
 * changes — and `dirty` is set inside announce() rather than by a listener, so
 * it cannot depend on listener ordering.
 */
let snapshot: Command[] = [];
let dirty = true;

function announce() {
  dirty = true;
  listeners.forEach((l) => l());
}

export function publishCommands(commands: Command[]): () => void {
  const key = ++nextScope;
  scopes.set(key, commands);
  announce();
  return () => {
    scopes.delete(key);
    announce();
  };
}

export function onCommandsChange(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCommands(): Command[] {
  if (dirty) {
    snapshot = [...scopes.values()].flat();
    dirty = false;
  }
  return snapshot;
}

/**
 * One frozen empty array, not a fresh one per call — same referential-equality
 * requirement as getSnapshot, and it is the reason the previous version warned
 * about an infinite loop.
 */
const EMPTY: Command[] = [];
export const serverCommands = (): Command[] => EMPTY;
