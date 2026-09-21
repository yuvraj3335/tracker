'use client';

import { useEffect, useRef } from 'react';
import { SHORTCUTS } from '@/lib/keys';

/**
 * The "?" overlay.
 *
 * A native <dialog> so the browser supplies the modal semantics, the backdrop
 * and Escape-to-close, rather than reimplementing them. Focus is moved into the
 * dialog on open and it can always be dismissed — the one thing an overlay like
 * this must never do is trap you.
 */
export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        // Clicking the backdrop closes. The dialog element itself covers the
        // whole viewport, so a hit outside the inner panel is a backdrop hit.
        if (e.target === ref.current) onClose();
      }}
      aria-label="Keyboard shortcuts"
      className="skin-card m-auto w-[min(26rem,calc(100vw-2rem))] border border-hairline bg-surface p-0 text-ink shadow-lift-3 backdrop:bg-black/40"
    >
      <div className="px-4 py-3.5">
        <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
        <dl className="mt-3 space-y-1.5">
          {SHORTCUTS.map((s) => (
            <div key={s.label} className="flex items-center justify-between gap-4">
              <dt className="text-xs text-ink-2">{s.label}</dt>
              <dd className="flex shrink-0 gap-1">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="skin-pill min-w-[1.5rem] border border-hairline bg-surface-2 px-1.5 py-0.5 text-center text-micro font-medium text-ink-2"
                  >
                    {k}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          onClick={onClose}
          className="skin-pill mt-3.5 w-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Got it
        </button>
      </div>
    </dialog>
  );
}
