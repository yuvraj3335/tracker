'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Mascot } from './mascot';
import { onCelebrate, type Celebration } from '@/lib/celebrate';
import { getSkin, serverSkin, subscribe } from '@/lib/appearance';
import { THEMES } from '@/lib/themes';
import { cn } from '@/lib/utils';

/**
 * The celebration layer. Mounted once in the layout; any task row fires into it.
 *
 * Sits in a fixed, pointer-events-none corner so it can never block a tap or
 * shift the page — the whole thing is transform and opacity only. Announced
 * politely to screen readers via the live region, so the feedback is not purely
 * visual. Respects prefers-reduced-motion through the global rule in
 * globals.css, which collapses every animation to near-zero duration.
 */
const HOLD_MS = 1900;

export function CelebrationLayer() {
  const skin = useSyncExternalStore(subscribe, getSkin, serverSkin);
  const theme = THEMES[skin];
  const [event, setEvent] = useState<Celebration | null>(null);

  useEffect(() => onCelebrate(setEvent), []);

  // Clear after the animation finishes. Keyed on id so a rapid second
  // completion restarts the timer rather than cutting the first one short.
  useEffect(() => {
    if (!event) return;
    const t = setTimeout(() => setEvent(null), HOLD_MS);
    return () => clearTimeout(t);
  }, [event]);

  const showMascot = theme.mascot !== 'none';

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-16 z-40 flex flex-col items-center gap-1 sm:bottom-6"
      aria-live="polite"
      aria-atomic="true"
    >
      {event ? (
        <div key={event.id} className="flex flex-col items-center gap-1">
          {showMascot ? (
            <div className="relative">
              {/* impact ring on the bigger moments */}
              {event.kind !== 'cheer' ? (
                <span
                  className="js-ring absolute inset-0 rounded-full"
                  style={{ border: '2px solid var(--accent)' }}
                />
              ) : null}

              <Mascot id={theme.mascot} state="jump" size={event.kind === 'cheer' ? 64 : 84} />

              {/* sparkle burst — each shard gets its own vector via CSS vars */}
              {SPARKS.map((s, i) => (
                <span
                  key={`${event.id}-${i}`}
                  className="js-spark absolute top-1/2 left-1/2 block rounded-full"
                  style={
                    {
                      width: s.size,
                      height: s.size,
                      background: i % 2 ? 'var(--seq-3)' : 'var(--accent)',
                      animationDelay: `${s.delay}ms`,
                      '--sx': s.x,
                      '--sy': s.y,
                    } as React.CSSProperties
                  }
                />
              ))}
            </div>
          ) : null}

          <span
            className={cn(
              'js-rise skin-pill border px-3 py-1 text-xs font-semibold shadow-lift-3',
              event.kind === 'cheer' ? 'text-ink' : 'text-accent-ink',
            )}
            style={{
              background: event.kind === 'cheer' ? 'var(--surface)' : 'var(--accent)',
              borderColor: 'var(--border)',
            }}
          >
            {event.message}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Fixed offsets rather than random, so the burst looks designed and is stable. */
const SPARKS = [
  { x: '-30px', y: '-30px', size: 6, delay: 0 },
  { x: '28px', y: '-34px', size: 5, delay: 60 },
  { x: '-40px', y: '-6px', size: 4, delay: 30 },
  { x: '38px', y: '-4px', size: 5, delay: 90 },
  { x: '-14px', y: '-46px', size: 4, delay: 120 },
  { x: '16px', y: '-48px', size: 6, delay: 45 },
];
