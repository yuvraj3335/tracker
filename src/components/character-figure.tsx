'use client';

import Image from 'next/image';
import { useSyncExternalStore } from 'react';
import { Mascot } from './mascot';
import { useActiveCharacter } from './character-provider';
import { getSkin, serverSkin, subscribe } from '@/lib/appearance';
import { resolvePose, type Pose } from '@/lib/characters';
import { THEMES } from '@/lib/themes';
import { cn } from '@/lib/utils';

/**
 * Draws whichever figure is active: an installed character's art, or the
 * original SVG mascot.
 *
 * One component for both so no caller has to branch. The fallback is silent and
 * total — no art installed, none chosen, a stale id, or a character missing the
 * pose all land on the mascot, and the mascot itself renders nothing for the
 * Studio skin, which deliberately has none.
 *
 * Motion is the same either way: a slow bob at rest, the squash-and-stretch hop
 * for the two celebratory poses. Both are transform-only and both collapse
 * under the global reduced-motion rule in globals.css.
 */
export function CharacterFigure({
  pose = 'idle',
  size = 72,
  priority = false,
  className,
}: {
  pose?: Pose;
  size?: number;
  /** Preloads the image. Only the dashboard's resting figure sets this. */
  priority?: boolean;
  className?: string;
}) {
  const character = useActiveCharacter();
  const skin = useSyncExternalStore(subscribe, getSkin, serverSkin);
  const src = resolvePose(character, pose);

  const motion = pose === 'celebrate' || pose === 'milestone' ? 'js-jump' : 'js-bob';

  if (!src) {
    const mascot = THEMES[skin].mascot;
    if (mascot === 'none') return null;
    return (
      <Mascot
        id={mascot}
        state={pose === 'celebrate' || pose === 'milestone' ? 'jump' : 'idle'}
        size={size}
        className={className}
      />
    );
  }

  return (
    // Fixed box with explicit image dimensions: the figure can never shift
    // layout while the art loads, which matters most in the celebration overlay.
    <span
      className={cn('relative inline-block shrink-0 overflow-hidden', motion, className)}
      style={{ width: size, height: size, transformOrigin: '50% 100%' }}
      aria-hidden
    >
      <Image
        src={src}
        alt=""
        width={size}
        height={size}
        priority={priority}
        sizes={`${size}px`}
        className="h-full w-full object-contain"
        draggable={false}
      />
    </span>
  );
}

/** A resting figure for empty states and headers. */
export function CharacterBadge({
  size = 40,
  priority = false,
}: {
  size?: number;
  priority?: boolean;
}) {
  return <CharacterFigure pose="idle" size={size} priority={priority} />;
}
