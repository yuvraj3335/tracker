'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { CharacterFigure } from './character-figure';
import { useActiveCharacter } from './character-provider';
import { onCelebrate, type Celebration, type CelebrationKind } from '@/lib/celebrate';
import type { Pose } from '@/lib/characters';
import type { VoiceKind } from '@/lib/character-voice';
import { getSkin, serverSkin, subscribe } from '@/lib/appearance';
import { pickCharacterLine } from '@/lib/character-voice';
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
 *
 * This is also the only place that resolves celebration copy: it reads the skin
 * and the active character once, rather than every row reading them 456 times.
 */
const HOLD_MS = 1900;

export function CelebrationLayer() {
  const skin = useSyncExternalStore(subscribe, getSkin, serverSkin);
  const character = useActiveCharacter();
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

  if (!event) {
    return <div className="pointer-events-none fixed inset-x-0 bottom-16 z-40 sm:bottom-6" aria-live="polite" aria-atomic="true" />;
  }

  const tier = TIERS[event.kind];
  const message = event.message ?? pickCharacterLine(character, tier.voice, theme, event.rotate);

  // A figure exists when a character is installed and chosen, or when the skin
  // ships a mascot. Studio has neither, and then only the line is shown.
  const hasFigure = Boolean(character) || theme.mascot !== 'none';

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-16 z-40 flex flex-col items-center gap-1 sm:bottom-6"
      aria-live="polite"
      aria-atomic="true"
    >
      <div key={event.id} className="flex flex-col items-center gap-1">
        {hasFigure ? (
          <div className="relative">
            {/* impact ring on the bigger moments */}
            {tier.rings > 0
              ? Array.from({ length: tier.rings }, (_, i) => (
                  <span
                    key={`${event.id}-ring-${i}`}
                    className="js-ring absolute inset-0 rounded-full"
                    style={{ border: '2px solid var(--accent)', animationDelay: `${i * 160}ms` }}
                  />
                ))
              : null}

            <CharacterFigure pose={tier.pose} size={tier.size} />

            {/* sparkle burst — each shard gets its own vector via CSS vars */}
            {SPARKS.slice(0, tier.sparks).map((s, i) => (
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
            'js-rise skin-pill border px-3 py-1 font-semibold shadow-lift-3',
            tier.big ? 'text-sm' : 'text-xs',
            tier.quiet ? 'text-ink' : 'text-accent-ink',
          )}
          style={{
            background: tier.quiet ? 'var(--surface)' : 'var(--accent)',
            borderColor: 'var(--border)',
          }}
        >
          {message}
        </span>
      </div>
    </div>
  );
}

/**
 * What each tier looks like.
 *
 * The escalation is deliberate and monotonic — every step up adds figure size,
 * sparks and rings — so the size of the moment is legible without reading the
 * words. A finished section should not land like one ticked question.
 */
const TIERS: Record<
  CelebrationKind,
  {
    voice: VoiceKind;
    pose: Pose;
    size: number;
    sparks: number;
    rings: number;
    big: boolean;
    /** Sits on a plain surface pill rather than a filled accent one. */
    quiet: boolean;
  }
> = {
  cheer:     { voice: 'cheer',       pose: 'celebrate', size: 78,  sparks: 0,  rings: 0, big: false, quiet: true },
  milestone: { voice: 'milestone',   pose: 'milestone', size: 100, sparks: 6,  rings: 1, big: false, quiet: false },
  section:   { voice: 'sectionDone', pose: 'milestone', size: 116, sparks: 10, rings: 2, big: true,  quiet: false },
  area:      { voice: 'finale',      pose: 'milestone', size: 136, sparks: 14, rings: 3, big: true,  quiet: false },
  // Going backwards. Same overlay, no sparks, no ring, and the quiet pill —
  // an accent-filled badge would make taking something back look like an
  // achievement.
  undo:      { voice: 'undo',        pose: 'crying',    size: 84,  sparks: 0,  rings: 0, big: false, quiet: true },
};

/** Fixed offsets rather than random, so the burst looks designed and is stable. */
const SPARKS = [
  { x: '-30px', y: '-30px', size: 6, delay: 0 },
  { x: '28px', y: '-34px', size: 5, delay: 60 },
  { x: '-40px', y: '-6px', size: 4, delay: 30 },
  { x: '38px', y: '-4px', size: 5, delay: 90 },
  { x: '-14px', y: '-46px', size: 4, delay: 120 },
  { x: '16px', y: '-48px', size: 6, delay: 45 },
  // The extra shards only appear on the two biggest tiers.
  { x: '-56px', y: '-28px', size: 5, delay: 150 },
  { x: '54px', y: '-24px', size: 4, delay: 110 },
  { x: '-24px', y: '-64px', size: 5, delay: 190 },
  { x: '26px', y: '-66px', size: 4, delay: 170 },
  { x: '-68px', y: '2px', size: 4, delay: 210 },
  { x: '66px', y: '6px', size: 5, delay: 230 },
  { x: '-6px', y: '-78px', size: 6, delay: 250 },
  { x: '8px', y: '-80px', size: 4, delay: 270 },
];
