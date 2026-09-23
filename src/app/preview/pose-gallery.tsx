'use client';

import { useState } from 'react';
import { CharacterFigure } from '@/components/character-figure';
import { POSES, type Pose } from '@/lib/characters';
import { cn } from '@/lib/utils';

/**
 * Every pose, one at a time.
 *
 * It used to draw all fourteen side by side, which is fourteen WebGL contexts
 * for a character that ships a model. Browsers keep about sixteen per
 * document and drop the oldest when you ask for more, so this page spent them
 * all: the last few poses came up blank, and — the part that mattered — the
 * companion's own figure and the panel's avatar were among the ones evicted,
 * so the harness broke the very thing it exists to review.
 *
 * One figure and a row of labels costs one context and shows the same poses,
 * with the added benefit that the transition between two of them is visible,
 * which is the thing a still grid could never show.
 */
export function PoseGallery() {
  const [pose, setPose] = useState<Pose>('idle');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-4">
        <CharacterFigure pose={pose} size={96} />
        <span className="text-micro tracking-wide text-ink-muted uppercase">{pose}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {POSES.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPose(p)}
            aria-pressed={p === pose}
            className={cn(
              'rounded-full border px-2.5 py-1 text-micro tracking-wide uppercase transition',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              p === pose
                ? 'border-accent bg-accent text-accent-ink'
                : 'border-control text-ink-muted hover:bg-surface-2 hover:text-ink',
            )}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
