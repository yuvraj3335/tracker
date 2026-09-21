'use client';

import { useSyncExternalStore } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';

type Mode = 'system' | 'light' | 'dark';
const KEY = 'jst-theme';

/** Writes `data-theme` on <html>; the CSS tokens do the rest. */
function apply(mode: Mode) {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
}

/*
 * The chosen theme lives in localStorage, which is an external store, so it is
 * read through useSyncExternalStore rather than mirrored into state by an
 * effect. The inline script in the root layout has already applied the
 * attribute before first paint, so there is nothing to synchronise on mount.
 *
 * localStorage can throw in a private window — every access is guarded, and a
 * failure just means the toggle falls back to following the OS.
 */
const listeners = new Set<() => void>();
let cachedMode: Mode | null = null;

function readMode(): Mode {
  if (cachedMode) return cachedMode;
  try {
    const saved = localStorage.getItem(KEY) as Mode | null;
    cachedMode = saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    cachedMode = 'system';
  }
  return cachedMode;
}

function writeMode(mode: Mode) {
  cachedMode = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* ignore */
  }
  apply(mode);
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** The server has no localStorage; 'system' is the correct pre-hydration answer. */
const serverMode = (): Mode => 'system';

const ORDER: Mode[] = ['system', 'light', 'dark'];

export function ThemeToggle() {
  const mode = useSyncExternalStore(subscribe, readMode, serverMode);
  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor;

  return (
    <button
      type="button"
      onClick={() => writeMode(ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length])}
      aria-label={`Theme: ${mode}. Click to change.`}
      className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
    >
      <Icon className="size-4" />
    </button>
  );
}
