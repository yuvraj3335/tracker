'use client';

import { useSyncExternalStore } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { getMode, serverMode, setMode, subscribe, type Mode } from '@/lib/appearance';

const ORDER: Mode[] = ['system', 'light', 'dark'];

/** Cycles system -> light -> dark. The skin is a separate control. */
export function ThemeToggle() {
  const mode = useSyncExternalStore(subscribe, getMode, serverMode);
  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor;

  return (
    <button
      type="button"
      onClick={() => setMode(ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length])}
      aria-label={`Theme: ${mode}. Click to change.`}
      className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
    >
      <Icon className="size-4" />
    </button>
  );
}
