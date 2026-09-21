'use client';

import { useEffect, useState, useTransition } from 'react';
import { Undo2 } from 'lucide-react';
import { clearUndo, onUndoOffer, type UndoOffer } from '@/lib/undo';
import { cn } from '@/lib/utils';

/**
 * The undo affordance for the last toggle.
 *
 * Sits in the same bottom-centre corner as the celebration, stacked above it,
 * but is a separate element because it has to be clickable — the celebration
 * overlay is deliberately `pointer-events-none` so it can never swallow a tap,
 * and widening that to cover a button would undo the guarantee.
 *
 * The window is short and the countdown is drawn, so the toast never becomes
 * furniture: it is either useful in the next few seconds or it is gone.
 */
const WINDOW_MS = 6000;

export function UndoToast() {
  const [offer, setOffer] = useState<UndoOffer | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => onUndoOffer(setOffer), []);

  useEffect(() => {
    if (!offer) return;
    const t = setTimeout(() => setOffer(null), WINDOW_MS);
    return () => clearTimeout(t);
  }, [offer]);

  if (!offer) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-40 flex justify-center px-3 sm:bottom-20">
      <div
        // key restarts the countdown animation when a second toggle supersedes
        // the first, rather than letting the bar continue from where it was.
        key={offer.id}
        className={cn(
          'pointer-events-auto js-rise-in relative flex max-w-full items-center gap-3 overflow-hidden',
          'skin-pill border border-hairline bg-surface py-1.5 pr-1.5 pl-3 shadow-lift-3',
        )}
      >
        <span className="truncate text-xs text-ink-2">{offer.label}</span>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await offer.run();
              clearUndo();
            })
          }
          className={cn(
            'skin-pill inline-flex shrink-0 items-center gap-1 px-2.5 py-1 text-xs font-semibold',
            'bg-accent text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          )}
        >
          <Undo2 className="size-3" />
          Undo
        </button>

        {/* Time remaining, drawn rather than counted down in text. Transform
            only, and the global reduced-motion rule collapses it to a static
            bar — the toast still works, it just does not animate out. */}
        <span
          className="js-countdown absolute inset-x-0 bottom-0 h-0.5 origin-left bg-accent/40"
          aria-hidden
        />
      </div>
    </div>
  );
}
